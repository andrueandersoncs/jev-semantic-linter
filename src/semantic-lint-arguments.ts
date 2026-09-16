import type { Result } from "./semantic-lint-result";
import type { Configuration } from "./semantic-lint-types";

export type ArgumentState = Readonly<{
  threshold: number;
  model?: string;
  json: boolean;
  dryRun: boolean;
}>;

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

export function argumentStateFromTokens(
  args: readonly string[],
  index: number,
  state: ArgumentState,
  config: Configuration,
): Result<ArgumentState> {
  const arg = args[index];
  if (arg === undefined) {
    return { ok: true, value: state };
  }

  const nextIndex = index + config.arguments.nextOffset;
  const optionValueIndex = index + config.arguments.valueOptionWidth;
  switch (arg) {
    case config.arguments.thresholdFlag:
    case config.arguments.modelFlag: {
      const value = optionValue(args, index, arg, config);
      if (!value.ok) {
        return value;
      }
      const isThreshold = arg === config.arguments.thresholdFlag;
      const nextState = isThreshold
        ? { ...state, threshold: Number(value.value) }
        : { ...state, model: value.value };
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
    default:
      return { ok: false, error: `Unexpected argument: ${arg}` };
  }
}
