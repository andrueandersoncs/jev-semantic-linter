import { lintCommandOutcome } from "./semantic-lint-command";
import type { SemanticLintServices } from "./semantic-lint-run";
import type { SemanticLintConfiguration } from "./semantic-lint-config";
import type { SemanticLintOutcome } from "./semantic-lint-report";

function reportText(
  report: SemanticLintOutcome["report"],
  jsonIndentSpaces: number,
): string {
  if (report.format === "text") {
    return report.text;
  }
  const containsRequests = report.documents.some(
    (document) => "kind" in document && document.kind === "dry-run-plan",
  );
  return JSON.stringify(
    report.documents,
    null,
    containsRequests ? undefined : jsonIndentSpaces,
  );
}

/** Writes one interpreted command result at the console boundary. */
export async function writeLintCommandOutput(
  args: readonly string[],
  config: SemanticLintConfiguration,
  services: SemanticLintServices,
): Promise<number> {
  const result = await lintCommandOutcome(args, config, services);
  if (!result.ok) {
    console.error(`semantic-lint: ${result.error.message}`);
    return config.processExitCodes.runtimeError;
  }
  const text = reportText(
    result.value.report,
    config.outputFormat.jsonIndentSpaces,
  );
  console.log(text);
  return result.value.processExitCode;
}
