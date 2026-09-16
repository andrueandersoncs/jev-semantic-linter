import { Glob } from "bun";
import {
  noul,
  TypeSafeClient,
  type NoulQuestion,
  type NoulResponse,
  type SystemOneRequest,
  type SystemOneResult,
} from "@typesafe-ai/sdk";
import semanticLintConfig from "./semantic-lint.config.json";

type Rule = Readonly<{
  id: string;
  path: string;
  title: string;
  text: string;
}>;

type Options = Readonly<{
  sourcePath: string;
  threshold: number;
  model?: string;
  json: boolean;
  dryRun: boolean;
}>;

type Configuration = Readonly<{
  arguments: Readonly<{
    firstIndex: number;
    nextOffset: number;
    valueOptionWidth: number;
    expectedSourceCount: number;
    runtimeStartIndex: number;
    optionPrefix: string;
    thresholdFlag: string;
    modelFlag: string;
    jsonFlag: string;
    dryRunFlag: string;
    helpFlag: string;
  }>;
  thresholds: Readonly<{
    defaultViolation: number;
    passMaximum: number;
    minimumExclusive: number;
    maximum: number;
  }>;
  rules: Readonly<{
    pattern: string;
    firstOrdinal: number;
    idPrefix: string;
    emptyLength: number;
    fileLabel: string;
  }>;
  output: Readonly<{
    jsonIndentSpaces: number;
    unknownLanguage: string;
    probabilityScale: number;
    probabilityColumnWidth: number;
    statusColumnWidth: number;
    sourceFileLabel: string;
    errorMarker: string;
    reviewMarker: string;
    passMarker: string;
  }>;
  question: Readonly<{
    task: string;
    guidance: string;
    violation: string;
    compliance: string;
  }>;
  exitCodes: Readonly<{
    success: number;
    findings: number;
    runtimeError: number;
  }>;
}>;

type ParseState = Readonly<{
  positional: readonly string[];
  threshold: number;
  model?: string;
  json: boolean;
  dryRun: boolean;
}>;

type Result<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: string }>;

type QuestionSet = Readonly<Record<string, NoulQuestion>>;
type EvaluationRequest = Readonly<SystemOneRequest<QuestionSet>>;
type EvaluationResponse = SystemOneResult<QuestionSet>;

type Finding = Rule &
  Readonly<{
    probability: number;
    status: "violation" | "review" | "pass";
  }>;

type LintOutcome = Readonly<{
  exitCode: number;
  output: string;
}>;

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function optionValue(
  args: readonly string[],
  index: number,
  option: string,
  config: Configuration,
): Result<string> {
  const valueIndex = index + config.arguments.nextOffset;
  const value = args[valueIndex];
  if (!value) {
    return { ok: false, error: `${option} requires a value` };
  }
  const isOption = value.startsWith(config.arguments.optionPrefix);
  if (isOption) {
    return { ok: false, error: `${option} requires a value` };
  }
  return { ok: true, value };
}

function argumentStateFromTokens(
  args: readonly string[],
  index: number,
  state: ParseState,
  config: Configuration,
): Result<ParseState> {
  const arg = args[index];
  if (arg === undefined) {
    return { ok: true, value: state };
  }

  const nextIndex = index + config.arguments.nextOffset;
  const optionValueIndex = index + config.arguments.valueOptionWidth;
  switch (arg) {
    case config.arguments.thresholdFlag: {
      const value = optionValue(args, index, arg, config);
      if (!value.ok) {
        return value;
      }
      const nextState = { ...state, threshold: Number(value.value) };
      return argumentStateFromTokens(
        args,
        optionValueIndex,
        nextState,
        config,
      );
    }
    case config.arguments.modelFlag: {
      const value = optionValue(args, index, arg, config);
      if (!value.ok) {
        return value;
      }
      const nextState = { ...state, model: value.value };
      return argumentStateFromTokens(
        args,
        optionValueIndex,
        nextState,
        config,
      );
    }
    case config.arguments.jsonFlag: {
      const nextState = { ...state, json: true };
      return argumentStateFromTokens(args, nextIndex, nextState, config);
    }
    case config.arguments.dryRunFlag: {
      const nextState = { ...state, dryRun: true };
      return argumentStateFromTokens(args, nextIndex, nextState, config);
    }
    default: {
      const isOption = arg.startsWith(config.arguments.optionPrefix);
      if (isOption) {
        return { ok: false, error: `Unknown option: ${arg}` };
      }
      const positional = [...state.positional, arg];
      const nextState = { ...state, positional };
      return argumentStateFromTokens(args, nextIndex, nextState, config);
    }
  }
}

function optionsFromArguments(
  args: readonly string[],
  config: Configuration,
): Result<Options | null> {
  const helpRequested = args.includes(config.arguments.helpFlag);
  if (helpRequested) {
    return { ok: true, value: null };
  }

  const initialState: ParseState = {
    positional: [],
    threshold: config.thresholds.defaultViolation,
    model: undefined,
    json: false,
    dryRun: false,
  };
  const parsed = argumentStateFromTokens(
    args,
    config.arguments.firstIndex,
    initialState,
    config,
  );
  if (!parsed.ok) {
    return parsed;
  }

  const sourceCount = parsed.value.positional.length;
  if (sourceCount !== config.arguments.expectedSourceCount) {
    return { ok: false, error: "Expected one source file" };
  }

  const threshold = parsed.value.threshold;
  const finiteThreshold = Number.isFinite(threshold);
  if (!finiteThreshold) {
    return { ok: false, error: "Threshold must be a finite number" };
  }
  if (threshold <= config.thresholds.minimumExclusive) {
    return {
      ok: false,
      error: `Threshold must exceed ${config.thresholds.minimumExclusive}`,
    };
  }
  if (threshold > config.thresholds.maximum) {
    return {
      ok: false,
      error: `Threshold must not exceed ${config.thresholds.maximum}`,
    };
  }

  const sourcePath = parsed.value.positional[config.arguments.firstIndex]!;
  return {
    ok: true,
    value: {
      sourcePath,
      threshold,
      model: parsed.value.model,
      json: parsed.value.json,
      dryRun: parsed.value.dryRun,
    },
  };
}

async function textFromFile(
  path: string,
  label: string,
): Promise<Result<string>> {
  try {
    const file = Bun.file(path);
    const exists = await file.exists();
    if (!exists) {
      return { ok: false, error: `${label} does not exist: ${path}` };
    }
    const text = await file.text();
    return { ok: true, value: text };
  } catch (error) {
    const message = errorMessage(error);
    const normalizedLabel = label.toLowerCase();
    return {
      ok: false,
      error: `Could not read ${normalizedLabel}: ${message}`,
    };
  }
}

async function rulePaths(pattern: string): Promise<Result<readonly string[]>> {
  try {
    const glob = new Glob(pattern);
    const scannedPaths = glob.scan(".");
    const paths = await Array.fromAsync(scannedPaths);
    const sortedPaths = paths.toSorted();
    return { ok: true, value: sortedPaths };
  } catch (error) {
    const message = errorMessage(error);
    return {
      ok: false,
      error: `Could not discover rule files: ${message}`,
    };
  }
}

function valuesFromResults<T>(results: readonly Result<T>[]): Result<readonly T[]> {
  return results.reduce<Result<readonly T[]>>(
    (collected, result) => {
      if (!collected.ok) {
        return collected;
      }
      if (!result.ok) {
        return result;
      }
      return {
        ok: true,
        value: [...collected.value, result.value],
      };
    },
    { ok: true, value: [] },
  );
}

async function rulesFromFiles(
  config: Configuration["rules"],
): Promise<Result<readonly Rule[]>> {
  const paths = await rulePaths(config.pattern);
  if (!paths.ok) {
    return paths;
  }
  if (paths.value.length === config.emptyLength) {
    return { ok: false, error: `No rule files match ${config.pattern}` };
  }

  const rulePromises = paths.value.map(
    async (path, index): Promise<Result<Rule>> => {
      const contents = await textFromFile(path, config.fileLabel);
      if (!contents.ok) {
        return contents;
      }

      const text = contents.value.trim();
      if (text.length === config.emptyLength) {
        return { ok: false, error: `Rule file is empty: ${path}` };
      }

      const headingMatch = text.match(/^#\s+(.+)$/m);
      const [, heading] = headingMatch ?? [];
      const trimmedHeading = heading?.trim();
      const title = trimmedHeading ?? path;
      const ordinal = index + config.firstOrdinal;
      const id = `${config.idPrefix}${ordinal}`;
      return {
        ok: true,
        value: { id, path, title, text },
      };
    },
  );
  const loaded = await Promise.all(rulePromises);
  return valuesFromResults(loaded);
}

function questionsFromRules(
  rules: readonly Rule[],
  config: Configuration["question"],
): QuestionSet {
  const entries = rules.map((rule) => {
    const instructions = {
      task: config.task,
      rule: {
        source: rule.path,
        definition: rule.text,
      },
      guidance: config.guidance,
    };
    const criteria = {
      true: config.violation,
      false: config.compliance,
    };
    const question = noul(instructions, criteria);
    return [rule.id, question] as const;
  });
  return Object.fromEntries(entries);
}

function findingFromAnswer(
  rule: Rule,
  answer: NoulResponse,
  threshold: number,
  passMaximum: number,
): Finding {
  if (answer.noul >= threshold) {
    return { ...rule, probability: answer.noul, status: "violation" };
  }
  if (answer.noul <= passMaximum) {
    return { ...rule, probability: answer.noul, status: "pass" };
  }
  return { ...rule, probability: answer.noul, status: "review" };
}

function findingsFromAnswers(
  rules: readonly Rule[],
  answers: Readonly<Record<string, NoulResponse>>,
  threshold: number,
  passMaximum: number,
): Result<readonly Finding[]> {
  const findingResults = rules.map((rule): Result<Finding> => {
    const answer = answers[rule.id];
    if (!answer) {
      return {
        ok: false,
        error: `TypeSafe returned no answer for ${rule.id}`,
      };
    }
    const finding = findingFromAnswer(
      rule,
      answer,
      threshold,
      passMaximum,
    );
    return { ok: true, value: finding };
  });
  return valuesFromResults(findingResults);
}

function humanReport(
  findings: readonly Finding[],
  config: Configuration,
): string {
  const markers: Readonly<Record<Finding["status"], string>> = {
    violation: config.output.errorMarker,
    review: config.output.reviewMarker,
    pass: config.output.passMarker,
  };
  const findingLines = findings.map((finding) => {
    const marker = markers[finding.status];
    const scaledProbability =
      finding.probability * config.output.probabilityScale;
    const roundedProbability = Math.round(scaledProbability);
    const percent = `${roundedProbability}%`;
    const probability = percent.padStart(
      config.output.probabilityColumnWidth,
    );
    const status = marker.padEnd(config.output.statusColumnWidth);
    return `[${status} ${probability}] ${finding.title} (${finding.path})`;
  });
  const violations = findings.filter(
    (finding) => finding.status === "violation",
  ).length;
  const reviews = findings.filter(
    (finding) => finding.status === "review",
  ).length;
  const passed = findings.length - violations - reviews;
  const summary = `${violations} violation(s), ${reviews} need review, ${passed} passed`;
  return [...findingLines, "", summary].join("\n");
}

async function systemOneResponse(
  request: EvaluationRequest,
): Promise<Result<EvaluationResponse>> {
  try {
    const client = new TypeSafeClient();
    return { ok: true, value: await client.systemOne(request) };
  } catch (error) {
    return {
      ok: false,
      error: `TypeSafe request failed: ${errorMessage(error)}`,
    };
  }
}

function requestFromSource(
  options: Options,
  source: string,
  questions: QuestionSet,
  config: Configuration,
): EvaluationRequest {
  const extensionMatch = options.sourcePath.match(/\.([^.]+)$/);
  const [, extension] = extensionMatch ?? [];
  const request: EvaluationRequest = {
    state: {
      code: {
        filename: options.sourcePath,
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

function reportFromFindings(
  findings: readonly Finding[],
  response: EvaluationResponse,
  options: Options,
  config: Configuration,
): string {
  if (!options.json) {
    return humanReport(findings, config);
  }
  const report = {
    source: options.sourcePath,
    model: response.model,
    threshold: options.threshold,
    findings,
    usage: response.usage,
  };
  return JSON.stringify(report, null, config.output.jsonIndentSpaces);
}

function exitCodeFromFindings(
  findings: readonly Finding[],
  config: Configuration,
): number {
  const hasFindings = findings.some(
    (finding) => finding.status !== "pass",
  );
  if (hasFindings) {
    return config.exitCodes.findings;
  }
  return config.exitCodes.success;
}

async function lintOutcome(
  options: Options,
  config: Configuration,
): Promise<Result<LintOutcome>> {
  const sourcePromise = textFromFile(
    options.sourcePath,
    config.output.sourceFileLabel,
  );
  const rulesPromise = rulesFromFiles(config.rules);
  const [source, rules] = await Promise.all([sourcePromise, rulesPromise]);
  if (!source.ok) {
    return source;
  }
  if (!rules.ok) {
    return rules;
  }

  const questions = questionsFromRules(rules.value, config.question);
  const request = requestFromSource(
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

  const response = await systemOneResponse(request);
  if (!response.ok) {
    return response;
  }

  const findings = findingsFromAnswers(
    rules.value,
    response.value.answers,
    options.threshold,
    config.thresholds.passMaximum,
  );
  if (!findings.ok) {
    return findings;
  }

  const output = reportFromFindings(
    findings.value,
    response.value,
    options,
    config,
  );
  const exitCode = exitCodeFromFindings(findings.value, config);
  return { ok: true, value: { exitCode, output } };
}

async function processExitCode(): Promise<number> {
  const config: Configuration = semanticLintConfig;
  const options = optionsFromArguments(
    Bun.argv.slice(config.arguments.runtimeStartIndex),
    config,
  );
  if (!options.ok) {
    console.error(`semantic-lint: ${options.error}`);
    return config.exitCodes.runtimeError;
  }
  if (!options.value) {
    const usage = [
      "Usage: bun run index.ts <source-file> [options]",
      "",
      "Options:",
      `  --threshold <number>  Violation probability threshold (default: ${config.thresholds.defaultViolation})`,
      "  --model <name>        TypeSafe model override (default: SDK default)",
      "  --json                Print machine-readable results",
      "  --dry-run             Print the TypeSafe request without sending it",
      "  --help                Show this help",
    ].join("\n");
    console.log(usage);
    return config.exitCodes.success;
  }

  const result = await lintOutcome(options.value, config);
  if (!result.ok) {
    console.error(`semantic-lint: ${result.error}`);
    return config.exitCodes.runtimeError;
  }
  console.log(result.value.output);
  return result.value.exitCode;
}

if (import.meta.main) {
  process.exit(await processExitCode());
}
