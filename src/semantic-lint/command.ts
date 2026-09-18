import { parseArgs } from "node:util";
import { errorMessage } from "../error-message";
import type { InvalidArgumentsError, SemanticLintFailure } from "./errors";
import { lintRunOutcome, type SemanticLintServices } from "./run";
import { fail, ok, type Result } from "../result";
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
): Result<SemanticLintOptions, InvalidArgumentsError> {
  try {
    const values = parseArgs({
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
    }).values;
    const violationProbabilityThreshold =
      values.threshold === undefined
        ? config.probabilityThresholds.defaultViolationProbabilityThreshold
        : Number(values.threshold);
    const thresholdError = thresholdErrorMessage(
      violationProbabilityThreshold,
      config,
    );
    if (thresholdError !== undefined) {
      return fail({ tag: "InvalidArgumentsError", message: thresholdError });
    }
    return ok({
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
    });
  } catch (cause) {
    return fail({
      tag: "InvalidArgumentsError",
      message: errorMessage(cause),
    });
  }
}

/**
 * Interprets one CLI invocation. Runtime effects are limited to the supplied
 * services; expected failures return in the Result error branch.
 */
export async function lintCommandOutcome(
  args: readonly string[],
  config: SemanticLintConfiguration,
  services: SemanticLintServices,
): Promise<Result<SemanticLintOutcome, SemanticLintFailure>> {
  if (args.includes(config.argumentDefaults.helpFlag)) {
    return ok({
      processExitCode: config.processExitCodes.success,
      report: {
        format: "text",
        text: usageFromConfiguration(config),
      },
    });
  }
  const options = optionsFromArguments(args, config);
  return options.ok ? lintRunOutcome(options.value, config, services) : options;
}
