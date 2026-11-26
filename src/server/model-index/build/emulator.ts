import fs from "node:fs";
import path from "node:path";

// Reads the aws-emulator clone. Read-only: nothing here opens a file for writing, and the clone is never executed.

export type EmulatorOperation = {
  /** `scaffolded` is a stub answering 501 NotImplemented; `unwired` is modelled but has no handler and also answers 501. */
  state: "implemented" | "scaffolded" | "unwired";
};

export type EmulatorCrate = {
  dir: string;
  sdkId: string;
  /** The wire protocol the Emulator states (first one on the `Protocol:` line of its OPERATIONS.md); none for CBOR-only services. */
  protocol?: string;
  operations: Map<string, EmulatorOperation>;
};

export type EmulatorSource = {
  version: string;
  commit: string;
  /** Model paths (relative to api-models-aws/models) of the services the Emulator offers. */
  offeredModelPaths: string[];
  crates: Map<string, EmulatorCrate>;
  operationFiles: number;
  scaffoldedFiles: number;
  unwiredOperations: number;
};

/**
 * The machine-readable record of a stub, per the Emulator's own README: the first doc line of an operation file.
 * Operations that carry it answer 501; deleting it is part of implementing the operation.
 */
const SCAFFOLDED_MARKER = /^\/\/! SCAFFOLDED, NOT IMPLEMENTED:/m;
const OP_NAME = /^\/\/! @op (\S+)/m;
const SKIPPED = /^\/\/ SKIPPED: (\S+)/gm;
const SDK_ID = /^- \*\*SDK id:\*\* `([^`]*)`/m;
const PROTOCOL = /^- \*\*Protocol:\*\* `([^`]*)`/m;

/** The folders git keeps a clone's data in: its own (with HEAD) and the shared one (with refs). They differ in a worktree. */
function gitDirs(repo: string): { git: string; common: string } {
  const dotGit = path.join(repo, ".git");
  if (!fs.existsSync(dotGit)) throw new Error(`${repo} is not a git clone (no .git); pass the Emulator version explicitly`);
  let git = dotGit;
  if (fs.statSync(dotGit).isFile()) {
    // A worktree or submodule: ".git" is a file reading "gitdir: <path>".
    const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, "utf8"));
    if (!m) throw new Error(`${dotGit} is a file but not a "gitdir:" pointer`);
    git = path.resolve(repo, m[1].trim());
    if (!fs.existsSync(path.join(git, "HEAD"))) throw new Error(`${dotGit} points at ${git}, which has no HEAD`);
  }
  const commondir = path.join(git, "commondir");
  const common = fs.existsSync(commondir) ? path.resolve(git, fs.readFileSync(commondir, "utf8").trim()) : git;
  return { git, common };
}

function within(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function looseTags(common: string): { name: string; sha: string }[] {
  const out: { name: string; sha: string }[] = [];
  const walk = (dir: string, prefix: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name), `${prefix}${e.name}/`);
      else out.push({ name: `${prefix}${e.name}`, sha: fs.readFileSync(path.join(dir, e.name), "utf8").trim() });
    }
  };
  walk(path.join(common, "refs", "tags"), "");
  return out;
}

function readHead(repo: string): { commit: string; tags: string[] } {
  const { git, common } = gitDirs(repo);
  const head = fs.readFileSync(path.join(git, "HEAD"), "utf8").trim();
  let commit = head;
  const packedFile = path.join(common, "packed-refs");
  const packed = fs.existsSync(packedFile) ? fs.readFileSync(packedFile, "utf8").split("\n") : [];
  if (head.startsWith("ref: ")) {
    const ref = head.slice(5).trim();
    const loose = path.resolve(common, ref);
    if (!within(loose, common)) throw new Error(`HEAD of ${repo} names a ref outside .git: ${ref}`);
    if (fs.existsSync(loose)) commit = fs.readFileSync(loose, "utf8").trim();
    else {
      const line = packed.find((l) => l.endsWith(` ${ref}`));
      if (!line) throw new Error(`cannot resolve ${ref} in ${repo}`);
      commit = line.split(" ")[0];
    }
  }
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`HEAD of ${repo} does not resolve to a commit (got "${commit.slice(0, 60)}")`);
  const tags: string[] = [];
  for (let i = 0; i < packed.length; i++) {
    const m = /^([0-9a-f]{40}) refs\/tags\/(.+)$/.exec(packed[i]);
    if (!m) continue;
    // An annotated tag is followed by a "^<commit>" line naming the commit it points at.
    const peeled = packed[i + 1]?.startsWith("^") ? packed[i + 1].slice(1).trim() : m[1];
    if (peeled === commit) tags.push(m[2]);
  }
  // Loose tags count when they point straight at the commit (lightweight tags).
  for (const t of looseTags(common)) if (t.sha === commit && !tags.includes(t.name)) tags.push(t.name);
  return { commit, tags };
}

/** The commit a clone is checked out at, read from its `.git` folder without running git. */
export function readCommit(repo: string): string {
  return readHead(repo).commit;
}

/** `v1.0.509` -> `1.0.509`. The tag that points at the clone's checked-out commit, or the version given explicitly. */
function resolveVersion(repo: string, explicit?: string): { version: string; commit: string } {
  const { commit, tags } = readHead(repo);
  if (explicit) return { version: explicit, commit };
  const release = tags.filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
  if (release.length !== 1) {
    throw new Error(
      `cannot tell which Emulator release ${repo} is at (tags at ${commit}: ${tags.join(", ") || "none"}); pass the version explicitly`,
    );
  }
  return { version: release[0].slice(1), commit };
}

export function readEmulator(emulatorDir: string, explicitVersion?: string): EmulatorSource {
  const { version, commit } = resolveVersion(emulatorDir, explicitVersion);

  const specs = JSON.parse(fs.readFileSync(path.join(emulatorDir, ".emulator", "scaffolded-specs.json"), "utf8")) as {
    scaffolded_services: { shape_id: string; spec_url: string }[];
  };
  const offeredModelPaths = specs.scaffolded_services.map((s) => {
    const i = s.spec_url.indexOf("/models/");
    if (i < 0) throw new Error(`unexpected spec_url ${s.spec_url}`);
    return s.spec_url.slice(i + "/models/".length);
  });

  const servicesDir = path.join(emulatorDir, "services");
  const crates = new Map<string, EmulatorCrate>();
  let operationFiles = 0;
  let scaffoldedFiles = 0;
  let unwiredOperations = 0;
  for (const name of fs.readdirSync(servicesDir).filter((n) => n.startsWith("service-")).sort()) {
    const dir = path.join(servicesDir, name);
    const doc = fs.readFileSync(path.join(dir, "OPERATIONS.md"), "utf8");
    const sdkId = SDK_ID.exec(doc)?.[1];
    if (!sdkId) throw new Error(`${name}/OPERATIONS.md has no SDK id`);
    const protocol = PROTOCOL.exec(doc)?.[1];
    if (crates.has(sdkId)) throw new Error(`two Emulator crates claim SDK id ${sdkId}`);

    const operations = new Map<string, EmulatorOperation>();
    const opsDir = path.join(dir, "src", "ops");
    for (const file of fs.readdirSync(opsDir)) {
      if (!file.endsWith(".rs") || file === "mod.rs") continue;
      operationFiles++;
      const text = fs.readFileSync(path.join(opsDir, file), "utf8");
      const op = OP_NAME.exec(text)?.[1];
      if (!op) throw new Error(`${name}/src/ops/${file} has no "//! @op <Name>" line`);
      const scaffolded = SCAFFOLDED_MARKER.test(text);
      if (scaffolded) scaffoldedFiles++;
      operations.set(op, { state: scaffolded ? "scaffolded" : "implemented" });
    }
    const skipped = path.join(opsDir, "SKIPPED_STUBS.md");
    if (fs.existsSync(skipped)) {
      for (const m of fs.readFileSync(skipped, "utf8").matchAll(SKIPPED)) {
        if (operations.has(m[1])) continue;
        operations.set(m[1], { state: "unwired" });
        unwiredOperations++;
      }
    }
    crates.set(sdkId, { dir: name, sdkId, protocol, operations });
  }
  return { version, commit, offeredModelPaths, crates, operationFiles, scaffoldedFiles, unwiredOperations };
}
