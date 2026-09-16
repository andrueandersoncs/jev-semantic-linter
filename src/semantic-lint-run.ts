import { changedFilePaths } from "./changed-file-paths";
import { lintOutcomes } from "./semantic-lint-evaluation";
import type { Result } from "./semantic-lint-result";
import {
  exitCodeFromOutcomes,
  reportFromOutcomes,
} from "./semantic-lint-report";
import type {
  Configuration,
  LintOutcome,
  Options,
} from "./semantic-lint-types";

export async function lintRunOutcome(
  options: Options,
  config: Configuration,
): Promise<Result<LintOutcome>> {
  const sourcePaths = await changedFilePaths();
  if (!sourcePaths.ok) {
    return sourcePaths;
  }

  const outcomes = await lintOutcomes(
    sourcePaths.value,
    options,
    config,
  );
  if (!outcomes.ok) {
    return outcomes;
  }

  const output = reportFromOutcomes(outcomes.value, options, config);
  const exitCode = exitCodeFromOutcomes(outcomes.value, config);
  return { ok: true, value: { exitCode, output } };
}
