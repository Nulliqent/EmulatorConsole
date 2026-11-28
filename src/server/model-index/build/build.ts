import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type {
  EmulatorOnlyOperation,
  ImplementationLabel,
  ListClass,
  ModelIndexMeta,
  OperationInfo,
  Protocol,
  ServiceSummary,
} from "../../../shared/models.js";
import { INDEX_FILE, SCHEMA_VERSION, SERVICES_DIR, serviceFileName } from "../types.js";
import type { ModelIndexFile, ServiceModelFile, SmithyShape } from "../types.js";
import { byCodePoint, classifyService, describeOperation, pruneShape, readService } from "./analyze.js";
import { readCommit, readEmulator } from "./emulator.js";

export type BuildOptions = {
  /** Root of the api-models-aws clone (the folder holding `models/`). Read only. */
  apiModelsDir: string;
  /** Root of the aws-emulator clone. Read only. */
  emulatorDir: string;
  /** Where the generated artifact goes. Must be outside both clones. */
  outDir: string;
  /** The Emulator release the clone is at, when its tags cannot say. */
  emulatorVersion?: string;
};

export type BuildResult = { meta: ModelIndexMeta; bytes: number; files: number };

const slugOf = (sdkId: string) => sdkId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The real path of `p`, following symlinks in its deepest existing ancestor when `p` itself does not exist yet. */
function realOrResolved(p: string): string {
  const resolved = path.resolve(p);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    const parent = path.dirname(resolved);
    return parent === resolved ? resolved : path.join(realOrResolved(parent), path.basename(resolved));
  }
}

function inside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Refuses an output folder inside, or containing, either reference clone. */
export function assertOutsideSources(outDir: string, sources: string[]): void {
  const out = realOrResolved(outDir);
  for (const s of sources) {
    const src = realOrResolved(s);
    if (inside(out, src) || inside(src, out)) {
      throw new Error(`refusing to write the model index to ${outDir}: it overlaps the reference clone ${s}, which is read-only`);
    }
  }
}

/** Writes to a temporary name and renames it into place, so a symlink at `file` is replaced, never written through. */
function writeFileAtomic(file: string, data: string | Buffer): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.rmSync(tmp, { force: true });
  fs.writeFileSync(tmp, data, { flag: "wx" });
  fs.renameSync(tmp, file);
}

function listModelPaths(modelsRoot: string): string[] {
  const paths: string[] = [];
  for (const d of fs.readdirSync(modelsRoot).sort()) {
    const serviceDir = path.join(modelsRoot, d, "service");
    if (!fs.existsSync(serviceDir)) continue;
    for (const v of fs.readdirSync(serviceDir).sort()) {
      for (const f of fs.readdirSync(path.join(serviceDir, v)).sort()) {
        if (f.endsWith(".json")) paths.push(`${d}/service/${v}/${f}`);
      }
    }
  }
  return paths;
}

function label(state: "implemented" | "scaffolded" | "unwired" | undefined): ImplementationLabel {
  if (state === "implemented") return "implemented";
  if (state === "scaffolded" || state === "unwired") return "not-implemented";
  return "not-in-emulator";
}

/**
 * Builds the Service Model index from the two reference clones and writes it to `outDir`:
 * `index.json` (all services, counts, the Emulator version the labels describe) and one brotli-compressed
 * `services/<slug>.json.br` per service holding its operations and its Smithy shape graph.
 * Only `outDir` is written; both clones are only read.
 */
export function buildModelIndex(opts: BuildOptions): BuildResult {
  const apiModelsDir = path.resolve(opts.apiModelsDir);
  const emulatorDir = path.resolve(opts.emulatorDir);
  const outDir = path.resolve(opts.outDir);
  assertOutsideSources(outDir, [apiModelsDir, emulatorDir]);

  const modelsRoot = path.join(apiModelsDir, "models");
  const emulator = readEmulator(emulatorDir, opts.emulatorVersion);
  const allModels = listModelPaths(modelsRoot);
  const offered = new Set(emulator.offeredModelPaths);
  for (const p of offered) if (!allModels.includes(p)) throw new Error(`the Emulator offers ${p}, which api-models-aws does not have`);

  const services: ServiceSummary[] = [];
  const files: { slug: string; file: ServiceModelFile }[] = [];
  const notOffered: ModelIndexMeta["models"]["notOffered"] = [];
  const slugs = new Set<string>();
  const seenCrates = new Set<string>();

  for (const modelPath of allModels) {
    const ast = JSON.parse(fs.readFileSync(path.join(modelsRoot, modelPath), "utf8")) as { shapes: Record<string, SmithyShape> };
    const facts = readService(ast, modelPath);
    if (!offered.has(modelPath)) {
      notOffered.push({ sdkId: facts.sdkId, title: facts.title, path: modelPath });
      continue;
    }
    const crate = emulator.crates.get(facts.sdkId);
    if (!crate) throw new Error(`${modelPath}: the Emulator has no crate for SDK id ${facts.sdkId}`);
    // The Emulator states the protocol it speaks for each service; the one the index chose must agree.
    // A service with no Protocol line is one the Emulator speaks only over rpcv2Cbor.
    const stated = crate.protocol ?? "rpcv2Cbor";
    if (stated !== facts.protocol) {
      throw new Error(`${facts.sdkId}: the index chose protocol ${facts.protocol} but the Emulator (${crate.dir}) states ${stated}`);
    }
    seenCrates.add(facts.sdkId);
    const slug = slugOf(facts.sdkId);
    if (slugs.has(slug)) throw new Error(`two services share the slug ${slug}`);
    slugs.add(slug);

    const memo = new Map<string, string[]>();
    const operations: OperationInfo[] = facts.operationIds.map((id) => {
      const info = describeOperation(ast, id, memo);
      return { ...info, implementation: label(crate.operations.get(info.name)?.state) };
    });
    const modelled = new Set(operations.map((o) => o.name));
    const emulatorOnly: EmulatorOnlyOperation[] = [...crate.operations]
      .filter(([name]) => !modelled.has(name))
      .map(([name, op]) => ({ name, implementation: op.state === "implemented" ? ("implemented" as const) : ("not-implemented" as const) }))
      .sort((a, b) => byCodePoint(a.name, b.name));

    const kinds = operations.map((o) => o.list);
    const count = (l: ImplementationLabel) => operations.filter((o) => o.implementation === l).length;
    services.push({
      sdkId: facts.sdkId,
      shapeId: facts.shapeId,
      slug,
      title: facts.title,
      protocol: facts.protocol,
      protocols: facts.protocols,
      awsQueryCompatible: facts.awsQueryCompatible,
      ...(facts.signingName ? { signingName: facts.signingName } : {}),
      ...(facts.endpointPrefix ? { endpointPrefix: facts.endpointPrefix } : {}),
      ...(facts.arnNamespace ? { arnNamespace: facts.arnNamespace } : {}),
      modelPath,
      operationCount: operations.length,
      implemented: count("implemented"),
      notImplemented: count("not-implemented"),
      notInEmulator: count("not-in-emulator"),
      emulatorOnly: emulatorOnly.length,
      listClass: classifyService(kinds),
      listOperations: operations.filter((o) => o.list === "list" && o.implementation === "implemented").map((o) => o.name),
      getOrSearchOperations: operations.filter((o) => o.list === "get-or-search" && o.implementation === "implemented").map((o) => o.name),
      sensitiveOperations: operations.filter((o) => o.sensitive.input.length + o.sensitive.output.length > 0).length,
    });

    const shapes: Record<string, SmithyShape> = {};
    for (const [id, shape] of Object.entries(ast.shapes)) shapes[id] = pruneShape(shape);
    files.push({
      slug,
      file: {
        schemaVersion: SCHEMA_VERSION,
        sdkId: facts.sdkId,
        serviceShapeId: facts.shapeId,
        operations,
        commonErrors: facts.commonErrors,
        emulatorOnly,
        shapes,
      },
    });
  }

  for (const sdkId of emulator.crates.keys()) {
    if (!seenCrates.has(sdkId)) throw new Error(`the Emulator crate for ${sdkId} matched no Service Model`);
  }

  services.sort((a, b) => byCodePoint(a.sdkId, b.sdkId));
  const sum = (f: (s: ServiceSummary) => number) => services.reduce((n, s) => n + f(s), 0);
  const tally = <K extends string>(keys: K[], pick: (s: ServiceSummary) => K) =>
    Object.fromEntries(keys.map((k) => [k, services.filter((s) => pick(s) === k).length])) as Record<K, number>;
  const meta: ModelIndexMeta = {
    schemaVersion: SCHEMA_VERSION,
    emulator: { version: emulator.version, commit: emulator.commit },
    models: {
      repository: "aws/api-models-aws",
      commit: readCommit(apiModelsDir),
      total: allModels.length,
      offered: services.length,
      notOffered: notOffered.sort((a, b) => byCodePoint(a.sdkId, b.sdkId)),
    },
    counts: {
      services: services.length,
      operations: sum((s) => s.operationCount),
      implemented: sum((s) => s.implemented),
      notImplemented: sum((s) => s.notImplemented),
      notInEmulator: sum((s) => s.notInEmulator),
      emulatorOnly: sum((s) => s.emulatorOnly),
      listClass: tally<ListClass>(["list", "get-or-search", "none"], (s) => s.listClass),
      protocols: tally<Protocol>(
        ["restJson1", "awsJson1_0", "awsJson1_1", "awsQuery", "ec2Query", "restXml", "rpcv2Cbor"],
        (s) => s.protocol,
      ),
      awsQueryCompatible: services.filter((s) => s.awsQueryCompatible).length,
      emulatorOperationFiles: emulator.operationFiles,
      scaffoldedStubFiles: emulator.scaffoldedFiles,
      unwiredOperations: emulator.unwiredOperations,
    },
  };

  // Write. A stale artifact is replaced whole, so removed services do not linger.
  const servicesOut = path.join(outDir, SERVICES_DIR);
  fs.rmSync(servicesOut, { recursive: true, force: true });
  fs.mkdirSync(servicesOut, { recursive: true });
  let bytes = 0;
  for (const { slug, file } of files) {
    const packed = zlib.brotliCompressSync(Buffer.from(JSON.stringify(file)), {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_LGWIN]: 24 },
    });
    writeFileAtomic(path.join(servicesOut, serviceFileName(slug)), packed);
    bytes += packed.length;
  }
  const index: ModelIndexFile = { meta, services };
  const indexJson = JSON.stringify(index) + "\n";
  writeFileAtomic(path.join(outDir, INDEX_FILE), indexJson);
  bytes += Buffer.byteLength(indexJson);
  return { meta, bytes, files: files.length + 1 };
}
