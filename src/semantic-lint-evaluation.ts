import { TypeSafeClient } from "@typesafe-ai/sdk";
import { errorMessage } from "./error-message";
import {
  type Result,
  valuesFromResults,
} from "./semantic-lint-result";
import { findingsFromAnswers } from "./semantic-lint-findings";
import {
  exitCodeFromFindings,
  reportFromFindings,
} from "./semantic-lint-report";
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

async function systemOneResponse(
  client: TypeSafeClient,
  request: EvaluationRequest,
): Promise<Result<EvaluationResponse>> {
  try {
    return { ok: true, value: await client.systemOne(request) };
  } catch (error) {
    return {
      ok: false,
      error: `TypeSafe request failed: ${errorMessage(error)}`,
    };
  }
}

function requestFromSource(
  sourcePath: string,
  options: Options,
  source: string,
  questions: QuestionSet,
  config: Configuration,
): EvaluationRequest {
  const extensionMatch = sourcePath.match(/\.([^.]+)$/);
  const [, extension] = extensionMatch ?? [];
  const request: EvaluationRequest = {
    state: {
      code: {
        filename: sourcePath,
        language: extension ?? config.output.unknownLanguage,
        source,
      },
    },
    questions,
  };
  if (options.model === undefined) {
    return request;
  }
  return { ...request, model: options.model };
}

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

  const request = requestFromSource(
    sourcePath,
    options,
    source.value,
    questions,
    config,
  );
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

  const response = await systemOneResponse(client, request);
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

  const output = reportFromFindings(
    sourcePath,
    findings.value,
    response.value,
    options,
    config,
  );
  const exitCode = exitCodeFromFindings(findings.value, config);
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
