import { Readable } from "node:stream";
import { HttpResponse } from "@smithy/core/transport";
import type { SendResponse } from "../../shared/send.js";
import type { ServiceModelFile } from "../model-index/index.js";
import { bareCode, cutBody, declaredErrorNames, isDeclaredError, isEmulatorGap, wireErrorCode } from "./classify.js";
import type { CompiledService } from "./schema.js";
import { scrub, scrubBytes } from "./scrub.js";
import type { WireResponse } from "./transport.js";
import { toJson } from "./values.js";

/** What an Emulator answer means: everything in a `SendResponse` that comes from the answer itself. */
export type ReadAnswer = Pick<
  SendResponse,
  "status" | "headers" | "output" | "truncatedMembers" | "error" | "emulatorGap" | "unreadable" | "tooLarge" | "raw"
>;

/**
 * Reads one Emulator answer with the Service Model: parses it with the protocol class, classifies it (declared error,
 * Emulator Gap, unreadable, too large), cuts the raw body at 256 KB and scrubs the run's keys from all of it. Shared by
 * the sender and, later, the Gateway.
 */
export async function readAnswer(
  compiled: CompiledService,
  detail: ServiceModelFile,
  operation: string,
  wire: WireResponse,
  secrets: readonly string[],
): Promise<ReadAnswer> {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(wire.headers)) headers[k] = Array.isArray(v) ? v.join(", ") : v;

  let output: unknown;
  let error: SendResponse["error"];
  let unreadable = false;
  const truncated: NonNullable<SendResponse["truncatedMembers"]> = [];
  const bodyText = wire.body.subarray(0, 4096).toString("utf8");
  const code = wireErrorCode(headers, bodyText);

  if (!wire.tooLarge) {
    const context = compiled.createContext(operation, { hostname: "localhost", port: 0 });
    const protocol = compiled.createProtocol();
    protocol.setSerdeContext(context);
    const schema = compiled.operation(operation);
    try {
      const parsed = await protocol.deserializeResponse(
        schema,
        context,
        new HttpResponse({ statusCode: wire.status, headers, body: Readable.from(wire.body) }),
      );
      output = await toJson(parsed, { secrets, truncated });
    } catch (e) {
      const thrown = e as { name?: unknown; message?: unknown } | null;
      // The protocol classes build a service error (modelled or generic) from an error answer; it carries SDK
      // bookkeeping. Anything else, such as a JSON syntax error, means the model cannot read the answer.
      if (thrown !== null && typeof thrown === "object" && ("$metadata" in thrown || "$fault" in thrown)) {
        const name = typeof thrown.name === "string" ? thrown.name : "UnknownError";
        error = {
          name,
          message: typeof thrown.message === "string" ? thrown.message : "",
          declared: isDeclaredError(declaredErrorNames(detail, operation), name, code, headers["x-amzn-query-error"]?.split(";")[0]),
        };
        const members = await toJson(Object.fromEntries(Object.entries(thrown).filter(([k]) => k !== "name" && k !== "message")), { secrets, truncated });
        if (members && typeof members === "object" && Object.keys(members).length) error.details = members;
      } else {
        unreadable = true;
      }
    }
  }

  const raw = cutBody(wire.body, wire.size, undefined, wire.tooLarge);
  if (raw.encoding === "base64") {
    // Binary body: scrub the bytes that were cut, then encode again.
    const head = wire.body.subarray(0, 256 * 1024);
    const clean = scrubBytes(head, secrets);
    if (clean !== head) raw.body = Buffer.from(clean).toString("base64");
  }

  const answer: ReadAnswer = {
    status: wire.status,
    headers,
    ...(output !== undefined && !unreadable ? { output } : {}),
    ...(truncated.length ? { truncatedMembers: truncated } : {}),
    ...(error ? { error } : {}),
    emulatorGap: isEmulatorGap(wire.status, [error?.name, code, error?.name === undefined ? undefined : bareCode(error.name)], { modelled: true }),
    unreadable,
    tooLarge: wire.tooLarge,
    raw,
  };
  return scrub(answer, secrets) as ReadAnswer;
}
