import type http from "node:http";
import type { RefusedReason, SendRefused, SendRequest } from "../../shared/send.js";
import type { Config } from "../config.js";
import { modelIndex } from "../model-index/index.js";
import { BadSendRequest, sendOperation } from "./send.js";

/** The most request body POST /api/send reads: the input, with room for a few MB of base64 blob. */
export const MAX_SEND_BODY_BYTES = 8 * 1024 * 1024;
/** Sends in flight at once. Each can hold a large body in memory, so more than this are refused, not queued. */
export const MAX_SENDS_IN_FLIGHT = 6;

type Reply = { status: number; body: unknown };

const refused = (status: number, reason: RefusedReason, message: string): Reply => ({ status, body: { kind: "refused", reason, message } satisfies SendRefused });

let inFlight = 0;

/** Reads a request body as JSON, refusing one over `limit` bytes. */
export async function readJsonBody(req: http.IncomingMessage, limit = MAX_SEND_BODY_BYTES): Promise<{ ok: true; value: unknown } | { ok: false; reply: Reply }> {
  const tooLarge = refused(413, "too-large", "The request body is too large.");
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) return { ok: false, reply: tooLarge };
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) return { ok: false, reply: tooLarge };
    chunks.push(chunk as Buffer);
  }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { ok: false, reply: refused(400, "bad-json", "The request body is not valid JSON.") };
  }
}

/** Checks the shape of the request, not the input: the input is the model's to judge. */
export function parseSendRequest(value: unknown): SendRequest | string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "The body must be a JSON object.";
  const v = value as Record<string, unknown>;
  for (const key of ["sdkId", "operation", "region"] as const) {
    if (typeof v[key] !== "string" || !v[key] || (v[key] as string).length > 200) return `${key} is required.`;
  }
  if (v.sendInvalid !== undefined && typeof v.sendInvalid !== "boolean") return "sendInvalid must be a boolean.";
  if (v.s3Addressing !== undefined && v.s3Addressing !== "path" && v.s3Addressing !== "virtual-host") return "s3Addressing must be path or virtual-host.";
  return {
    sdkId: v.sdkId as string,
    operation: v.operation as string,
    region: v.region as string,
    input: v.input,
    sendInvalid: v.sendInvalid as boolean | undefined,
    s3Addressing: v.s3Addressing as SendRequest["s3Addressing"],
  };
}

/**
 * POST /api/send. State-changing (it calls the Emulator with the run's keys), so the caller has already passed the
 * Origin and content-type checks. The send is cancelled when the browser's connection closes (state E2's Cancel).
 * The Console's own refusals are `{ kind: "refused", ... }`, never mistaken for an Emulator answer.
 */
export async function handleSend(config: Config, req: http.IncomingMessage): Promise<Reply> {
  if (inFlight >= MAX_SENDS_IN_FLIGHT) return refused(503, "busy", "Too many sends are in progress. Try again in a moment.");
  inFlight++;
  const controller = new AbortController();
  const abort = () => controller.abort();
  try {
    const body = await readJsonBody(req);
    if (!body.ok) return body.reply;
    const request = parseSendRequest(body.value);
    if (typeof request === "string") return refused(400, "bad-request", request);

    req.socket.once("close", abort);
    const index = await modelIndex(config.modelIndexDir);
    return { status: 200, body: await sendOperation(config, index, request, { signal: controller.signal }) };
  } catch (e) {
    if (e instanceof BadSendRequest) {
      const r = refused(e.status, e.reason, e.message);
      if (e.eventStream) (r.body as SendRefused).eventStream = true;
      return r;
    }
    throw e;
  } finally {
    inFlight--;
    req.socket.off("close", abort);
  }
}
