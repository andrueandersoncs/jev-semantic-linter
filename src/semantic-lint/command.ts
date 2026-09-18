import { parseArgs } from "node:util";
import { Effect } from "effect";
import { errorMessage } from "../error-message";
import { InvalidArgumentsError, type SemanticLintFailure } from "./errors";
import { lintRunOutcome, type SemanticLintServices } from "./run";
import type { SemanticLintConfiguration, SemanticLintOptions } from "./config";
import type { SemanticLintOutcome } from "./report";

function usageFromConfiguration(config: SemanticLintConfiguration): string {
  return [
    "Usage: bun run apps/semantic-lint.ts [options]",
    "",
    "Options:",
    `  --threshold <number>  Violation probability threshold (default: ${config.probabilityThresholds.defaultViolationProbabilityThreshold})`,
    "  --model <name>        TypeSafe model override (default: SDK default)",
    "  --review-context <path>  Supply requirements, rationale, and measurements",
    "  --json                Print machine-readable results",
    "  --dry-run             Print the routing plan without sending requests",
    "  --help                Show this help",
  ].join("\n");
}

function thresholdErrorMessage(
  value: number,
  config: SemanticLintConfiguration,
): string | undefined {
  const thresholds = config.probabilityThresholds;
  if (!Number.isFinite(value)) {
    return "Threshold must be a finite number";
  }
  if (value <= thresholds.minimumViolationProbabilityExclusive) {
    return `Threshold must exceed ${thresholds.minimumViolationProbabilityExclusive}`;
  }
  if (value > thresholds.maximumViolationProbability) {
    return `Threshold must not exceed ${thresholds.maximumViolationProbability}`;
  }
  return undefined;
}

function optionsFromArguments(
  args: readonly string[],
  config: SemanticLintConfiguration,
): Effect.Effect<SemanticLintOptions, InvalidArgumentsError> {
  return Effect.flatMap(
    Effect.try({
      try: () =>
        parseArgs({
          args: [...args],
          options: {
            threshold: { type: "string" },
            model: { type: "string" },
            json: { type: "boolean" },
            "dry-run": { type: "boolean" },
            "review-context": { type: "string" },
          },
          strict: true,
          allowPositionals: false,
        }).values,
      catch: (cause) =>
        new InvalidArgumentsError({ message: errorMessage(cause) }),
    }),
    (values) => {
      const violationProbabilityThreshold =
        values.threshold === undefined
          ? config.probabilityThresholds.defaultViolationProbabilityThreshold
          : Number(values.threshold);
      const thresholdError = thresholdErrorMessage(
        violationProbabilityThreshold,
        config,
      );
      return thresholdError === undefined
        ? Effect.succeed({
            violationProbabilityThreshold,
            modelName: values.model,
            reviewContextPath: values["review-context"],
            outputFormat:
              values.json === true
                ? "json"
                : config.argumentDefaults.defaultOutputFormat,
            mode:
              values["dry-run"] === true
                ? "dry-run"
                : config.argumentDefaults.defaultMode,
          })
        : Effect.fail(new InvalidArgumentsError({ message: thresholdError }));
    },
  );
}

/** Interprets one CLI invocation as a lazy Effect program. */
export function lintCommandOutcome(
  args: readonly string[],
  config: SemanticLintConfiguration,
  services: SemanticLintServices,
): Effect.Effect<SemanticLintOutcome, SemanticLintFailure> {
  if (args.includes(config.argumentDefaults.helpFlag)) {
    return Effect.succeed({
      processExitCode: config.processExitCodes.success,
      report: {
        format: "text",
        text: usageFromConfiguration(config),
      },
    });
  }
  return Effect.flatMap(optionsFromArguments(args, config), (options) =>
    lintRunOutcome(options, config, services),
  );
}
