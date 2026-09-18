import type { SemanticLintGitAccess } from "./runtime/git-changes";
import type { SemanticLintFileAccess } from "./runtime/files";
import type { SemanticLintFailure } from "./errors";
import { evaluateSemanticLint } from "./routing/evaluation";
import type { SemanticLintEvaluation } from "./evaluator";
import {
  repositoryEvidence,
  type SemanticLintRepositoryEvidence,
} from "./evidence";
import { ok, type Result } from "../result";
import type { SemanticLintConfiguration, SemanticLintOptions } from "./config";
import type { SemanticLintOutcome } from "./report";

export type SemanticLintServices = Readonly<{
  git: SemanticLintGitAccess;
  files: SemanticLintFileAccess;
  createEvaluator: () => Result<SemanticLintEvaluation, SemanticLintFailure>;
}>;

async function evidenceForRun(
  options: SemanticLintOptions,
  config: SemanticLintConfiguration,
  services: SemanticLintServices,
): Promise<
  Result<SemanticLintRepositoryEvidence | undefined, SemanticLintFailure>
> {
  const snapshot = await services.git.repositorySnapshot();
  if (!snapshot.ok) {
    return snapshot;
  }
  if (snapshot.value.changedPaths.length === 0) {
    return ok(undefined);
  }
  const baseEvidence = await repositoryEvidence(
    {
      repositoryPaths: snapshot.value.repositoryPaths,
      changedPaths: snapshot.value.changedPaths,
      diff: snapshot.value.diff,
      config: config.evidence,
    },
    services.files,
  );
  if (!baseEvidence.ok || options.reviewContextPath === undefined) {
    return baseEvidence;
  }
  const reviewContext = await services.files.readText(
    options.reviewContextPath,
  );
  return reviewContext.ok
    ? ok({
        ...baseEvidence.value,
        reviewContext: {
          path: options.reviewContextPath,
          language: "text",
          source: reviewContext.value,
        },
      })
    : reviewContext;
}

/**
 * Loads one Git snapshot, optionally attaches review context, and evaluates it.
 * No-change runs succeed without creating a TypeSafe client.
 */
export async function lintRunOutcome(
  options: SemanticLintOptions,
  config: SemanticLintConfiguration,
  services: SemanticLintServices,
): Promise<Result<SemanticLintOutcome, SemanticLintFailure>> {
  const evidence = await evidenceForRun(options, config, services);
  if (!evidence.ok) {
    return evidence;
  }
  if (evidence.value === undefined) {
    return ok({
      processExitCode: config.processExitCodes.success,
      report: { format: "text", text: config.outputFormat.noChangedFiles },
    });
  }
  return evaluateSemanticLint(
    { evidence: evidence.value, options, config },
    services.files,
    services.createEvaluator,
  );
}
