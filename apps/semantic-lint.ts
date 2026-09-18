import { Effect } from "effect";
import { semanticLintConfig } from "../src/semantic-lint/config";
import { gitChanges } from "../src/semantic-lint/runtime/git-changes";
import { semanticLintFiles } from "../src/semantic-lint/runtime/files";
import { createSemanticLintEvaluator } from "../src/semantic-lint/runtime/typesafe/client";
import { writeLintCommandOutput } from "../src/semantic-lint/cli";
import type { SemanticLintServices } from "../src/semantic-lint/run";

const services: SemanticLintServices = {
  git: gitChanges,
  files: semanticLintFiles,
  createEvaluator: createSemanticLintEvaluator,
};

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  process.exit(
    await Effect.runPromise(
      writeLintCommandOutput(args, semanticLintConfig, services),
    ),
  );
}
