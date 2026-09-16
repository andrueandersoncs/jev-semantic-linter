import { processExitCode } from "./semantic-lint-cli";

if (import.meta.main) {
  process.exit(await processExitCode());
}