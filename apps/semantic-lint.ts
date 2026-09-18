import semanticLintConfig from "../semantic-lint.config.json";
import { gitChanges } from "../src/semantic-lint/runtime/git-changes";
import { semanticLintFiles } from "../src/semantic-lint/runtime/files";
import { createSemanticLintEvaluator } from "../src/semantic-lint/runtime/typesafe/client";
import { writeLintCommandOutput } from "../src/semantic-lint/cli";
import type { SemanticLintServices } from "../src/semantic-lint/run";
import type { SemanticLintConfiguration } from "../src/semantic-lint/config";

const services: SemanticLintServices = {
  git: gitChanges,
  files: semanticLintFiles,
  createEvaluator: createSemanticLintEvaluator,
};

if (import.meta.main) {
  const config = semanticLintConfig as SemanticLintConfiguration;
  const args = Bun.argv.slice(
    config.argumentDefaults.runtimeArgumentStartIndex,
  );
  process.exit(await writeLintCommandOutput(args, config, services));
}
