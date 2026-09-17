import { TypeSafeClient } from "@typesafe-ai/sdk";
import { errorMessage } from "./error-message";
import {
  type Result,
  valuesFromResults,
} from "./semantic-lint-result";
import { findingsFromAnswers } from "./semantic-lint-findings";
import { lintFindingReport } from "./semantic-lint-report";
import {
  questionsFromRules,
  rulesFromFiles,
} from "./semantic-lint-rules";
import type {
  Configuration,
  EvaluationRequest,
  EvaluationResponse,
  LintOutcome,
  Options,
  QuestionSet,
  Rule,
} from "./semantic-lint-types";
import { textFromFile } from "./text-from-file";

async function lintOutcomeFromSource(
  sourcePath: string,
  options: Options,
  config: Configuration,
  rules: readonly Rule[],
  questions: QuestionSet,
  client: TypeSafeClient,
): Promise<Result<LintOutcome>> {
  const source = await textFromFile(sourcePath, config.output.sourceFileLabel);
  if (!source.ok) {
    return source;
  }

  const extensionMatch = sourcePath.match(/\.([^.]+)$/);
  const [, extension] = extensionMatch ?? [];
  const request: EvaluationRequest = {
    state: {
      code: {
        filename: sourcePath,
        language: extension ?? config.output.unknownLanguage,
        source: source.value,
      },
    },
    questions,
    ...(options.model === undefined ? {} : { model: options.model }),
  };
  if (options.dryRun) {
    const output = JSON.stringify(
      request,
      null,
      config.output.jsonIndentSpaces,
    );
    return {
      ok: true,
      value: { exitCode: config.exitCodes.success, output },
    };
  }

  const response: Result<EvaluationResponse> = await client
    .systemOne(request)
    .then((value) => ({ ok: true, value }) as const)
    .catch((error: unknown) => ({
      ok: false,
      error: `TypeSafe request failed: ${errorMessage(error)}`,
    }));
  if (!response.ok) {
    return response;
  }

  const findings = findingsFromAnswers(
    rules,
    response.value.answers,
    options.threshold,
    config.thresholds.passMaximum,
  );
  if (!findings.ok) {
    return findings;
  }

  const output = lintFindingReport(
    sourcePath,
    findings.value,
    response.value,
    options,
    config,
  );
  const hasFindings = findings.value.some(
    (finding) => finding.status !== "pass",
  );
  const exitCode = hasFindings
    ? config.exitCodes.findings
    : config.exitCodes.success;
  return { ok: true, value: { exitCode, output } };
}

async function* outcomeResultsFromSourcePaths(
  sourcePaths: readonly string[],
  options: Options,
  config: Configuration,
  rules: readonly Rule[],
  questions: QuestionSet,
  client: TypeSafeClient,
): AsyncGenerator<Result<LintOutcome>> {
  for (const sourcePath of sourcePaths) {
    const outcome = await lintOutcomeFromSource(
      sourcePath,
      options,
      config,
      rules,
      questions,
      client,
    );
    yield outcome;
    if (!outcome.ok) {
      return;
    }
  }
}

export async function lintOutcomes(
  sourcePaths: readonly string[],
  options: Options,
  config: Configuration,
): Promise<Result<readonly LintOutcome[]>> {
  const rules = await rulesFromFiles(config.rules);
  if (!rules.ok) {
    return rules;
  }

  const questions = questionsFromRules(rules.value, config.question);
  const client = new TypeSafeClient();
  const outcomeResults = await Array.fromAsync(
    outcomeResultsFromSourcePaths(
      sourcePaths,
      options,
      config,
      rules.value,
      questions,
      client,
    ),
  );
  return valuesFromResults(outcomeResults);
}
