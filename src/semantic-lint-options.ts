import {
  argumentStateFromTokens,
  type ArgumentState,
} from "./semantic-lint-arguments";
import type { Result } from "./semantic-lint-result";
import type { Configuration, Options } from "./semantic-lint-types";

export function optionsFromArguments(
  args: readonly string[],
  config: Configuration,
): Result<Options | null> {
  const helpRequested = args.includes(config.arguments.helpFlag);
  if (helpRequested) {
    return { ok: true, value: null };
  }

  const initialState: ArgumentState = {
    threshold: config.thresholds.defaultViolation,
    model: undefined,
    json: config.arguments.defaultJson,
    dryRun: config.arguments.defaultDryRun,
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

  return {
    ok: true,
    value: {
      threshold,
      model: parsed.value.model,
      json: parsed.value.json,
      dryRun: parsed.value.dryRun,
    },
  };
}
