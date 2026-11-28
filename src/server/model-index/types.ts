import type { EmulatorOnlyOperation, ModelIndexMeta, OperationInfo, ServiceSummary } from "../../shared/models.js";

type Member = { target: string; traits?: Record<string, unknown> };

/**
 * One shape of a Smithy JSON AST model, with documentation, examples, endpoint rules, tests and other
 * presentation-only traits removed. Everything else (members, targets, protocol and constraint traits) is kept,
 * so later tickets can generate forms and convert to SDK schemas from it.
 */
export type SmithyShape = {
  type: string;
  traits?: Record<string, unknown>;
  members?: Record<string, Member>;
  /** list and set */
  member?: Member;
  /** map */
  key?: Member;
  value?: Member;
  [other: string]: unknown;
};

/** Contents of `index.json` in the generated artifact. */
export type ModelIndexFile = { meta: ModelIndexMeta; services: ServiceSummary[] };

/** Contents of `services/<slug>.json.br` in the generated artifact: one service, loaded on demand. */
export type ServiceModelFile = {
  schemaVersion: number;
  sdkId: string;
  serviceShapeId: string;
  operations: OperationInfo[];
  commonErrors: string[];
  emulatorOnly: EmulatorOnlyOperation[];
  shapes: Record<string, SmithyShape>;
};

export const SCHEMA_VERSION = 2;
export const INDEX_FILE = "index.json";
export const SERVICES_DIR = "services";
export const serviceFileName = (slug: string) => `${slug}.json.br`;
