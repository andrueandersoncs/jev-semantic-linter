import type {
  Configuration,
  EvaluationResponse,
  Finding,
  LintOutcome,
  Options,
} from "./semantic-lint-types";

function humanReport(
  sourcePath: string,
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
  return [
    `${config.output.sourceFileLabel}: ${sourcePath}`,
    ...findingLines,
    "",
    summary,
  ].join("\n");
}

export function reportFromFindings(
  sourcePath: string,
  findings: readonly Finding[],
  response: EvaluationResponse,
  options: Options,
  config: Configuration,
): string {
  if (!options.json) {
    return humanReport(sourcePath, findings, config);
  }
  const report = {
    source: sourcePath,
    model: response.model,
    threshold: options.threshold,
    findings,
    usage: response.usage,
  };
  return JSON.stringify(report, null, config.output.jsonIndentSpaces);
}

export function reportFromOutcomes(
  outcomes: readonly LintOutcome[],
  options: Options,
  config: Configuration,
): string {
  if (options.json || options.dryRun) {
    const reports = outcomes.map(
      (outcome): unknown => JSON.parse(outcome.output),
    );
    return JSON.stringify(reports, null, config.output.jsonIndentSpaces);
  }
  if (outcomes.length === config.rules.emptyLength) {
    return config.output.noChangedFiles;
  }
  return outcomes.map((outcome) => outcome.output).join("\n\n");
}

function exitCodeFromFindingPresence(
  hasFindings: boolean,
  config: Configuration,
): number {
  return hasFindings
    ? config.exitCodes.findings
    : config.exitCodes.success;
}

export function exitCodeFromFindings(
  findings: readonly Finding[],
  config: Configuration,
): number {
  const hasFindings = findings.some(
    (finding) => finding.status !== "pass",
  );
  return exitCodeFromFindingPresence(hasFindings, config);
}

export function exitCodeFromOutcomes(
  outcomes: readonly LintOutcome[],
  config: Configuration,
): number {
  const hasFindings = outcomes.some(
    (outcome) => outcome.exitCode === config.exitCodes.findings,
  );
  return exitCodeFromFindingPresence(hasFindings, config);
}
