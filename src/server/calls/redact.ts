import { HIDDEN, NOT_KEPT } from "../../shared/calls.js";

// What is never kept from a Call: signatures and session tokens. This runs before anything is stored, and the
// stored form is the only one that exists (a signature or token cannot be revealed later).

/** Header names never stored. */
const DROPPED_HEADERS = new Set(["x-amz-security-token", "x-amz-s3session-token", "proxy-authorization", "cookie", "set-cookie"]);
/** Query parameters never stored (presigned URLs, Signature Version 2, and the SigV2 session token). */
const DROPPED_QUERY = new Set(["x-amz-signature", "x-amz-security-token", "signature", "securitytoken"]);
/** Headers that carry a customer-provided encryption key. Hidden by name, whether or not the operation is identified. */
export const KEY_HEADERS = new Set([
  "x-amz-server-side-encryption-customer-key",
  "x-amz-copy-source-server-side-encryption-customer-key",
  "x-amz-sso_bearer_token", // SSO's access token; the model marks it sensitive, and this holds when the Call isn't identified
]);

export { NOT_KEPT };

/** An access key id is cut to its last four characters (`…MPLE`) wherever it is kept. */
export function shortKey(id: string): string {
  return id.length >= 12 ? `…${id.slice(-4)}` : HIDDEN;
}

/** `AKIA…/date/region/service/aws4_request` with the key id shortened. */
function shortCredential(credential: string): string {
  const slash = credential.indexOf("/");
  return slash === -1 ? shortKey(credential) : shortKey(credential.slice(0, slash)) + credential.slice(slash);
}

/**
 * An Authorization header without its signature (everything after `Signature`, however it is spaced) and with the
 * access key id shortened. Anything that is not a recognised AWS scheme is not kept at all: it may be a bearer token.
 */
export function redactAuthorization(value: string): string {
  if (!/^AWS4-[A-Z0-9-]+ /i.test(value)) return NOT_KEPT;
  const cut = value.search(/Signature/i);
  const kept = cut === -1 ? value : value.slice(0, cut) + `Signature=${NOT_KEPT}`;
  return kept.replace(/Credential\s*=\s*([^/,\s]*)/i, (_m, id: string) => `Credential=${shortKey(id)}`);
}

/** The headers to keep, in order: the Authorization signature removed and the tokens dropped. */
export function redactHeaders(headers: [string, string][]): [string, string][] {
  const out: [string, string][] = [];
  for (const [name, value] of headers) {
    const lower = name.toLowerCase();
    if (DROPPED_HEADERS.has(lower)) continue;
    out.push([name, lower === "authorization" ? redactAuthorization(value) : value]);
  }
  return out;
}

/** Hides, by name alone, the headers that carry an encryption key. Used when the operation can't say what is sensitive. */
export function hideKeyHeaders(headers: [string, string][]): [string, string][] {
  return headers.map(([n, v]): [string, string] => (KEY_HEADERS.has(n.toLowerCase()) ? [n, HIDDEN] : [n, v]));
}

/** The AWS4 credential scope of a request: from Authorization, or from a presigned URL's X-Amz-Credential. */
export function credentialScope(authorization: string | undefined, presignedCredential: string | undefined): { region?: string; service?: string } {
  const credential = authorization?.match(/Credential\s*=\s*([^,\s]+)/i)?.[1] ?? presignedCredential;
  if (!credential) return {};
  const parts = credential.split("/");
  // key id / date / region / service / aws4_request
  if (parts.length < 5) return {};
  return { region: parts[2] || undefined, service: parts[3] || undefined };
}

/** Whether a query parameter's name is one that must not be stored. */
export function isDroppedQueryParam(name: string): boolean {
  return DROPPED_QUERY.has(name.toLowerCase());
}

/** Splits a query string (without "?") into raw `[name, value]` pairs, decoded. A pair without "=" has value "". */
export function parseQuery(query: string): [string, string][] {
  if (!query) return [];
  return query.split("&").filter(Boolean).map((pair) => {
    const eq = pair.indexOf("=");
    const raw = (s: string) => {
      try {
        return decodeURIComponent(s.replace(/\+/g, " "));
      } catch {
        return s;
      }
    };
    return eq === -1 ? [raw(pair), ""] : [raw(pair.slice(0, eq)), raw(pair.slice(eq + 1))];
  });
}

export function formatQuery(pairs: [string, string][]): string {
  return pairs.map(([k, v]) => (v === "" ? encodeURIComponent(k) : `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)).join("&");
}

/** The pairs with signatures and tokens dropped, and the access key id shortened (`X-Amz-Credential`, `AWSAccessKeyId`). */
export function redactQuery(pairs: [string, string][]): [string, string][] {
  return pairs
    .filter(([name]) => !isDroppedQueryParam(name))
    .map(([name, value]): [string, string] => {
      const lower = name.toLowerCase();
      if (lower === "x-amz-credential") return [name, shortCredential(value)];
      if (lower === "awsaccesskeyid") return [name, shortKey(value)];
      return [name, value];
    });
}

const SESSION_TOKEN_JSON = /("(?:[Ss]ession[Tt]oken)"\s*:\s*)"(?:[^"\\]|\\.)*"/g;
const SESSION_TOKEN_XML = /(<(?:[\w-]+:)?[Ss]ession[Tt]oken(?:\s[^>]*)?>)[^<]*(<\/)/g;
const SIGNED_FORM_PART = /(name="(?:x-amz-signature|signature|x-amz-security-token)"(?:[^\r\n]*\r?\n)+?\r?\n)[\s\S]*?(\r?\n--)/gi;
const SIGNED_FORM_PARAM = /(^|&)(?:x-amz-signature|x-amz-security-token|signature|securitytoken)=[^&]*/gi;
const KEY_FORM_PARAM = /(^|&)(awsaccesskeyid|x-amz-credential)=([^&]*)/gi;
const KEY_FORM_PART = /(name="(?:x-amz-credential|awsaccesskeyid)"(?:[^\r\n]*\r?\n)+?\r?\n)([^\r\n]*)/gi;

const decode = (s: string) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
};

/** Whether bytes that could not be read as text still carry a signature or a session token, so they must not be kept. */
export function looksSecret(buf: Buffer): boolean {
  return /session[_-]?token|x-amz-signature|x-amz-security-token|chunk-signature|securitytoken/i.test(buf.toString("latin1"));
}

/**
 * A body text without what is never kept: JSON keys and XML elements named `SessionToken` (STS, Cognito Identity,
 * SSO), the signature and token parts of a multipart form (an S3 POST policy), and signature parameters of a
 * form-encoded body. Their values become "Not kept" in every copy of the Call, "Show" included.
 */
export function stripSecretValues(text: string): string {
  return text
    .replace(SESSION_TOKEN_JSON, `$1"${NOT_KEPT}"`)
    .replace(SESSION_TOKEN_XML, `$1${NOT_KEPT}$2`)
    .replace(SIGNED_FORM_PART, `$1${NOT_KEPT}$2`)
    .replace(SIGNED_FORM_PARAM, (m, lead: string) => `${lead}${m.slice(lead.length).replace(/=.*$/, "")}=${encodeURIComponent(NOT_KEPT)}`)
    .replace(KEY_FORM_PARAM, (_m, lead: string, name: string, value: string) => `${lead}${name}=${encodeURIComponent(name.toLowerCase() === "awsaccesskeyid" ? shortKey(decode(value)) : shortCredential(decode(value)))}`)
    .replace(KEY_FORM_PART, (_m, head: string, value: string) => `${head}${/\//.test(value) ? shortCredential(value) : shortKey(value)}`);
}
