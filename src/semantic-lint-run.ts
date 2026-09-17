import { changedFilePaths } from "./changed-file-paths";
import { lintOutcomes } from "./semantic-lint-evaluation";
import type { Result } from "./semantic-lint-result";
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

  const hasFindings = outcomes.value.some(
    (outcome) => outcome.exitCode === config.exitCodes.findings,
  );
  const exitCode = hasFindings
    ? config.exitCodes.findings
    : config.exitCodes.success;
  if (outcomes.value.length === config.rules.emptyLength) {
    return {
      ok: true,
      value: { exitCode, output: config.output.noChangedFiles },
    };
  }
  if (options.json || options.dryRun) {
    const reports = outcomes.value.map(
      (outcome): unknown => JSON.parse(outcome.output),
    );
    const output = JSON.stringify(
      reports,
      null,
      config.output.jsonIndentSpaces,
    );
    return { ok: true, value: { exitCode, output } };
  }
  const output = outcomes.value
    .map((outcome) => outcome.output)
    .join("\n\n");
  return { ok: true, value: { exitCode, output } };
}
