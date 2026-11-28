// Types for the Service Model index API, imported by both the server and the UI. Types only, no runtime code.

/** The wire protocols a Service Model can declare. The index records the one the Emulator speaks for a service. */
export type Protocol = "restJson1" | "awsJson1_0" | "awsJson1_1" | "awsQuery" | "ec2Query" | "restXml" | "rpcv2Cbor";

/**
 * Whether Emulator 1.0.509 (the version in `ModelIndexMeta.emulator`) implements an operation.
 * - `implemented`: the Emulator has a handler that is not the scaffolded 501 stub.
 * - `not-implemented`: the Emulator has the operation, but it is a scaffolded stub answering 501 NotImplemented.
 * - `not-in-emulator`: the Service Model has the operation and the Emulator has no handler for it at all.
 */
export type ImplementationLabel = "implemented" | "not-implemented" | "not-in-emulator";

/**
 * How a service opens as a resource list.
 * - `list`: a List or Describe operation that returns a collection and needs no input.
 * - `get-or-search`: no such List or Describe, but a Get or Search operation does.
 * - `none`: neither; the page opens on its operations.
 */
export type ListClass = "list" | "get-or-search" | "none";

/** How an operation qualifies as a list that needs no input (see `ListClass`). */
export type OperationListKind = "list" | "get-or-search";

export type ModelIndexMeta = {
  schemaVersion: number;
  /** SHA-256 (hex) over every service file's bytes, so the hash of index.json also covers them. */
  contentHash: string;
  /** The Emulator the implementation labels describe, read from the reference clone at build time. */
  emulator: { version: string; commit: string };
  /** The Service Models the index was built from. */
  models: {
    repository: string;
    commit: string;
    /** Models in the repository. */
    total: number;
    /** Models for services the Emulator offers; each is one entry in the index. */
    offered: number;
    /** Modelled services the Emulator lacks. They are not in the index. */
    notOffered: { sdkId: string; title: string; path: string }[];
  };
  counts: {
    services: number;
    operations: number;
    implemented: number;
    notImplemented: number;
    notInEmulator: number;
    /** Operations the Emulator has that the pinned Service Model does not (not counted in `operations`). */
    emulatorOnly: number;
    listClass: Record<ListClass, number>;
    protocols: Record<Protocol, number>;
    awsQueryCompatible: number;
    /** Operation files in the Emulator's service crates (one per operation it has a handler for). */
    emulatorOperationFiles: number;
    /** Of those, files still marked `SCAFFOLDED, NOT IMPLEMENTED`: stubs answering 501. */
    scaffoldedStubFiles: number;
    /** Operations the Emulator models but left unwired (no handler; its unroutable-operation path answers 501). */
    unwiredOperations: number;
  };
};

export type ServiceSummary = {
  /** The service's SDK ID, such as "DynamoDB" or "Application Auto Scaling". Unique; the key for every lookup. */
  sdkId: string;
  /** Smithy shape id of the service, such as "com.amazonaws.dynamodb#DynamoDB_20120810". */
  shapeId: string;
  /** Lower-case, URL-safe form of the SDK ID. */
  slug: string;
  title: string;
  protocol: Protocol;
  /** Every protocol the model declares, in declared order. */
  protocols: string[];
  /** The model also declares awsQueryCompatible (JSON service that accepts awsQuery error shapes). */
  awsQueryCompatible: boolean;
  signingName?: string;
  endpointPrefix?: string;
  arnNamespace?: string;
  /** Path of the Service Model within api-models-aws. */
  modelPath: string;
  operationCount: number;
  implemented: number;
  notImplemented: number;
  notInEmulator: number;
  /** Operations only the Emulator has. */
  emulatorOnly: number;
  listClass: ListClass;
  /**
   * Operations of the List or Describe tier that list without input and that the Emulator implements, so a page can
   * offer them. Empty when `listClass` is not `list`, or when the Emulator answers 501 or does not know every one of them.
   */
  listOperations: string[];
  /**
   * The same for the Get or Search tier. Kept apart because such an operation may return settings, not resources, so
   * it is checked per service. Filled whatever `listClass` is, from implemented operations only.
   */
  getOrSearchOperations: string[];
  /**
   * List or Describe operations the Emulator implements that return a collection but need input (a required member),
   * such as Budgets' DescribeBudgets. They cannot be read until the Developer supplies the input.
   */
  inputListOperations: string[];
  /** Operations with a member AWS marks sensitive, in their input or output. */
  sensitiveOperations: number;
};

export type OperationInfo = {
  name: string;
  /** Smithy shape id of the operation. */
  shapeId: string;
  /** Input structure shape id; absent when the operation takes none. */
  input?: string;
  output?: string;
  /** Shape ids of the errors this operation declares (not those every operation of the service shares). */
  errors: string[];
  http?: { method: string; uri: string; code?: number };
  readonly: boolean;
  idempotent: boolean;
  paginated: boolean;
  /** Set when the operation lists without input. */
  list?: OperationListKind;
  /** Set when the operation is a List or Describe that returns a collection but has a required input member. */
  listNeedsInput?: true;
  implementation: ImplementationLabel;
  /**
   * A summary for display, such as "this operation carries secrets": paths to the members AWS marks sensitive
   * (directly, or through their target shape), from the input or output structure: `Password`, `Config.Token`,
   * `Items[].Secret` (list element), `Map{}.Secret` (map value), `Map{key}` (map key). `$` stands for the whole
   * structure when it is itself sensitive. Sensitive members are not descended into, and a reference back to an
   * ancestor ends a branch.
   *
   * This is NOT the source for masking recorded Calls. Masking walks the decoded value against the service's shape
   * graph (`GET /api/service/shapes`), where `smithy.api#sensitive` stays on members and shapes.
   */
  sensitive: { input: string[]; output: string[] };
};

/** An operation only the Emulator has (its handler exists, the pinned Service Model has no such operation). */
export type EmulatorOnlyOperation = { name: string; implementation: "implemented" | "not-implemented" };

/** GET /api/services */
export type ServicesResponse = { meta: ModelIndexMeta; services: ServiceSummary[] };

/** GET /api/service?sdkId=... */
export type ServiceResponse = {
  emulator: ModelIndexMeta["emulator"];
  service: ServiceSummary;
  operations: OperationInfo[];
  /** Shape ids of the errors every operation of the service may return. */
  commonErrors: string[];
  emulatorOnly: EmulatorOnlyOperation[];
};

/** The `smithy.api#sensitive`-aware shape graph is Smithy JSON AST, one entry per shape id; see src/server/model-index. */
export type ShapeGraph = Record<string, unknown>;

/**
 * GET /api/service/shapes?sdkId=... (or `slug=`), optionally `&operation=Name`.
 * Without `operation`, every shape of the service; with it, the shapes reachable from that operation (its input,
 * output and declared errors). Traits are kept (`smithy.api#error`, `smithy.api#httpError`,
 * `aws.protocols#awsQueryError`, `smithy.api#sensitive`, ...).
 */
export type ShapesResponse = {
  sdkId: string;
  serviceShapeId: string;
  /** Shape ids of the errors every operation of the service may return. */
  commonErrors: string[];
  shapes: ShapeGraph;
};
