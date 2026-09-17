import type {
  Configuration,
  EvaluationResponse,
  Finding,
  Options,
} from "./semantic-lint-types";

export function lintFindingReport(
  sourcePath: string,
  findings: readonly Finding[],
  response: EvaluationResponse,
  options: Options,
  config: Configuration,
): string {
  if (options.json) {
    return JSON.stringify(
      {
        source: sourcePath,
        model: response.model,
        threshold: options.threshold,
        findings,
        usage: response.usage,
      },
      null,
      config.output.jsonIndentSpaces,
    );
  }

  const findingLines = findings.map(
    (finding) =>
      `[${finding.status} ${finding.probability}] ${finding.title} (${finding.path})`,
  );
  return [
    `${config.output.sourceFileLabel}: ${sourcePath}`,
    ...findingLines,
  ].join("\n");
}
