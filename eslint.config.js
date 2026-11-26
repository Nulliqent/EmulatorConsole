import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "aws-emulator/", "api-models-aws/", ".aws/", "docs/", ".claude/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
