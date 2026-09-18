import { Effect } from "effect";
import type { SemanticLintGitAccess } from "./runtime/git-changes";
import type { SemanticLintFileAccess } from "./runtime/files";
import type { SemanticLintFailure } from "./errors";
import { evaluateSemanticLint } from "./routing/evaluation";
import type { SemanticLintEvaluation } from "./evaluator";
import {
  repositoryEvidence,
  type SemanticLintRepositoryEvidence,
} from "./evidence";
import type { SemanticLintConfiguration, SemanticLintOptions } from "./config";
import type { SemanticLintOutcome } from "./report";

export type SemanticLintServices = Readonly<{
  git: SemanticLintGitAccess;
  files: SemanticLintFileAccess;
  createEvaluator: Effect.Effect<SemanticLintEvaluation, SemanticLintFailure>;
}>;

function evidenceForRun(
  options: SemanticLintOptions,
  config: SemanticLintConfiguration,
  services: SemanticLintServices,
): Effect.Effect<
  SemanticLintRepositoryEvidence | undefined,
  SemanticLintFailure
> {
  return Effect.gen(function* () {
    const snapshot = yield* services.git.repositorySnapshot();
    if (snapshot.changedPaths.length === 0) {
      return undefined;
    }
    const baseEvidence = yield* repositoryEvidence(
      {
        repositoryPaths: snapshot.repositoryPaths,
        changedPaths: snapshot.changedPaths,
        diff: snapshot.diff,
        config: config.evidence,
      },
      services.files,
    );
    if (options.reviewContextPath === undefined) {
      return baseEvidence;
    }
    const reviewContext = yield* services.files.readText(
      options.reviewContextPath,
    );
    return {
      ...baseEvidence,
      reviewContext: {
        path: options.reviewContextPath,
        language: "text",
        source: reviewContext,
      },
    };
  });
}

/** Loads one Git snapshot, attaches context, and evaluates it. */
export function lintRunOutcome(
  options: SemanticLintOptions,
  config: SemanticLintConfiguration,
  services: SemanticLintServices,
): Effect.Effect<SemanticLintOutcome, SemanticLintFailure> {
  return Effect.flatMap(
    evidenceForRun(options, config, services),
    (evidence) =>
      evidence === undefined
        ? Effect.succeed({
            processExitCode: 0,
            report: {
              format: "text",
              text: "No changed files to lint.",
            },
          })
        : evaluateSemanticLint(
            { evidence, options, config },
            services.files,
            services.createEvaluator,
          ),
  );
}
