import { errorMessage } from "./error-message";
import type { Result } from "./semantic-lint-result";

export async function textFromFile(
  path: string,
  label: string,
): Promise<Result<string>> {
  try {
    return { ok: true, value: await Bun.file(path).text() };
  } catch (error) {
    return {
      ok: false,
      error: `Could not read ${label.toLowerCase()}: ${errorMessage(error)}`,
    };
  }
}
