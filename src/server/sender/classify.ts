import type { RawBody } from "../../shared/send.js";
import type { ServiceModelFile } from "../model-index/index.js";

/** How much of an answer's body is returned (state E6). */
export const RAW_BODY_LIMIT = 256 * 1024;

/** `com.amazonaws.sqs#Name` and `Name:http://...` reduced to `Name`. */
export const bareCode = (code: string): string => code.split(":")[0]!.split("#").pop()!;

/**
 * The Emulator does not do this, as opposed to the operation refusing the input: 501 NotImplemented, UnknownService
 * (404), or InvalidAction for an operation the Service Model has (the Emulator lacks the action; for an action the
 * model does not have, InvalidAction is the Developer's mistake). See decisions.md. `names` are every name the error
 * arrived under: the SDK's parsed name, then the wire code.
 */
export function isEmulatorGap(status: number, names: Array<string | undefined>, { modelled }: { modelled: boolean }): boolean {
  const has = (n: string) => names.some((x) => x !== undefined && bareCode(x) === n);
  if (status === 501 || has("NotImplemented")) return true;
  if (status === 404 && has("UnknownService")) return true;
  return modelled && has("InvalidAction");
}

/**
 * The error code on the wire, for when the SDK's own parse gave an unhelpful name: the `x-amzn-errortype` header, or
 * the body's `__type`, `code` or `<Code>`. Best effort; undefined when none is found.
 */
export function wireErrorCode(headers: Record<string, string>, body: string): string | undefined {
  const header = headers["x-amzn-errortype"];
  if (header) return bareCode(header);
  const head = body.slice(0, 4096);
  const json = /"(?:__type|code|Code)"\s*:\s*"([^"]{1,200})"/.exec(head);
  if (json) return bareCode(json[1]!);
  const xml = /<Code>([^<]{1,200})<\/Code>/.exec(head);
  return xml ? bareCode(xml[1]!) : undefined;
}

const own = <T>(o: Record<string, T> | undefined, k: string): T | undefined => (o && Object.hasOwn(o, k) ? o[k] : undefined);

/**
 * The names an operation's declared errors can arrive under: each error shape's name, and for awsQuery-style errors the
 * wire code in `aws.protocols#awsQueryError` (SQS answers `AWS.SimpleQueueService.NonExistentQueue` for
 * `QueueDoesNotExist`). Errors every operation of the service may return count too.
 */
export function declaredErrorNames(detail: ServiceModelFile, operation: string): Set<string> {
  const names = new Set<string>();
  const op = detail.operations.find((o) => o.name === operation);
  if (!op) return names;
  for (const id of [...op.errors, ...detail.commonErrors]) {
    const shape = own(detail.shapes, id);
    names.add(id.split("#")[1]!);
    const query = own(shape?.traits, "aws.protocols#awsQueryError") as { code?: string } | undefined;
    if (query?.code) names.add(query.code);
  }
  return names;
}

/** Whether the model declares an error that arrived as any of `names`. A wire code such as `ns#Name` or `Name:http://...` is reduced to its name. */
export function isDeclaredError(declared: Set<string>, ...names: Array<string | undefined>): boolean {
  return names.some((n) => {
    if (!n) return false;
    return declared.has(n) || declared.has(bareCode(n));
  });
}

/**
 * The first 256 KB of an answer as text, or as base64 when it is not text. `size` is the whole body's; when the
 * reader stopped early (`sizeIsMinimum`), it is only the bytes seen so far.
 */
export function cutBody(bytes: Buffer, size = bytes.length, limit = RAW_BODY_LIMIT, sizeIsMinimum = false): RawBody {
  const truncated = size > limit || sizeIsMinimum;
  const head = bytes.subarray(0, limit);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  // A cut can land inside a multi-byte character; give up to three bytes back before calling the body binary.
  for (let drop = 0; drop <= (truncated ? 3 : 0); drop++) {
    try {
      return { body: decoder.decode(head.subarray(0, head.length - drop)), encoding: "utf8", size, sizeIsMinimum, truncated };
    } catch {
      // try again
    }
  }
  return { body: head.toString("base64"), encoding: "base64", size, sizeIsMinimum, truncated };
}
