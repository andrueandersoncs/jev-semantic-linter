import { errorMessage } from "./error-message";
import type { Result } from "./semantic-lint-result";

export async function textFromFile(
  path: string,
  label: string,
): Promise<Result<string>> {
  try {
    const file = Bun.file(path);
    const exists = await file.exists();
    if (!exists) {
      return { ok: false, error: `${label} does not exist: ${path}` };
    }
    const text = await file.text();
    return { ok: true, value: text };
  } catch (error) {
    const message = errorMessage(error);
    const normalizedLabel = label.toLowerCase();
    return {
      ok: false,
      error: `Could not read ${normalizedLabel}: ${message}`,
    };
  }
}
