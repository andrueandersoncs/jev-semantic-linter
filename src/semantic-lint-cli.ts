import semanticLintConfig from "../semantic-lint.config.json";
import { lintRunOutcome } from "./semantic-lint-run";
import { optionsFromArguments } from "./semantic-lint-options";
import type { Configuration } from "./semantic-lint-types";

export async function processExitCode(): Promise<number> {
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
      "Usage: bun run src/index.ts [options]",
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

  const result = await lintRunOutcome(options.value, config);
  if (!result.ok) {
    console.error(`semantic-lint: ${result.error}`);
    return config.exitCodes.runtimeError;
  }
  console.log(result.value.output);
  return result.value.exitCode;
}
