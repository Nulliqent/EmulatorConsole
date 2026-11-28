// Generates data/model-index from the two reference clones. Run with `npm run model-index`.
//   --api-models <dir>   api-models-aws clone   (env API_MODELS_DIR, default ./api-models-aws)
//   --emulator <dir>     aws-emulator clone     (env AWS_EMULATOR_DIR, default ./aws-emulator)
//   --out <dir>          output folder          (default ./data/model-index; must be outside both clones)
//   --emulator-version   release the Emulator clone is at, if its tags cannot say
import path from "node:path";
import { parseArgs } from "node:util";
import { buildModelIndex } from "./build.js";

const { values } = parseArgs({
  options: {
    "api-models": { type: "string" },
    emulator: { type: "string" },
    out: { type: "string" },
    "emulator-version": { type: "string" },
  },
});

const started = Date.now();
const result = buildModelIndex({
  apiModelsDir: path.resolve(values["api-models"] ?? process.env.API_MODELS_DIR ?? "api-models-aws"),
  emulatorDir: path.resolve(values.emulator ?? process.env.AWS_EMULATOR_DIR ?? "aws-emulator"),
  outDir: path.resolve(values.out ?? "data/model-index"),
  emulatorVersion: values["emulator-version"],
});
const c = result.meta.counts;
console.log(
  `Wrote ${result.files} files (${(result.bytes / 1e6).toFixed(2)} MB) in ${((Date.now() - started) / 1000).toFixed(1)} s: ` +
    `${c.services} services, ${c.operations} operations for Emulator ${result.meta.emulator.version} ` +
    `(${c.implemented} implemented, ${c.notImplemented} not implemented, ${c.notInEmulator} not in the Emulator).`,
);
