import { parseArgs } from "node:util";
import { errorMessage } from "./error-message";
import type { Result } from "./semantic-lint-result";
import type { Configuration, Options } from "./semantic-lint-types";

export function optionsFromArguments(
  args: readonly string[],
  config: Configuration,
): Result<Options | null> {
  if (args.includes(config.arguments.helpFlag)) {
    return { ok: true, value: null };
  }

  try {
    const { values } = parseArgs({
      args: [...args],
      options: {
        threshold: { type: "string" },
        model: { type: "string" },
        json: { type: "boolean" },
        "dry-run": { type: "boolean" },
      },
      strict: true,
      allowPositionals: false,
    });
    const threshold =
      values.threshold === undefined
        ? config.thresholds.defaultViolation
        : Number(values.threshold);
    if (!Number.isFinite(threshold)) {
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

    return {
      ok: true,
      value: {
        threshold,
        model: values.model,
        json: values.json ?? config.arguments.defaultJson,
        dryRun: values["dry-run"] ?? config.arguments.defaultDryRun,
      },
    };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}
