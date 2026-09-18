import { Console, Effect } from "effect";
import { lintCommandOutcome } from "./command";
import type { SemanticLintServices } from "./run";
import type { SemanticLintConfiguration } from "./config";
import type { SemanticLintOutcome } from "./report";

function reportText(report: SemanticLintOutcome["report"]): string {
  if (report.format === "text") {
    return report.text;
  }
  const containsRequests = report.documents.some(
    (document) => "kind" in document && document.kind === "dry-run-plan",
  );
  return JSON.stringify(
    report.documents,
    null,
    containsRequests ? undefined : 2,
  );
}

/** Writes one interpreted command result at the console boundary. */
export function writeLintCommandOutput(
  args: readonly string[],
  config: SemanticLintConfiguration,
  services: SemanticLintServices,
): Effect.Effect<number> {
  return Effect.matchEffect(lintCommandOutcome(args, config, services), {
    onFailure: (error) =>
      Effect.map(Console.error(`semantic-lint: ${error.message}`), () => 2),
    onSuccess: (outcome) =>
      Effect.map(
        Console.log(reportText(outcome.report)),
        () => outcome.processExitCode,
      ),
  });
}
