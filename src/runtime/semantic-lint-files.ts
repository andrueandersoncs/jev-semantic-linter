import { Glob } from "bun";
import { errorMessage } from "../error-message";
import type { FileAccessError } from "../semantic-lint-errors";
import { fail, ok, type Result } from "../result";

export type SemanticLintFileAccess = Readonly<{
  readText: (filePath: string) => Promise<Result<string, FileAccessError>>;
  findPaths: (
    pattern: string,
  ) => Promise<Result<readonly string[], FileAccessError>>;
}>;

/** Bun filesystem boundary. */
export const semanticLintFiles: SemanticLintFileAccess = {
  async readText(filePath) {
    try {
      return ok(await Bun.file(filePath).text());
    } catch (cause) {
      return fail({
        tag: "FileAccessError",
        path: filePath,
        message: `Could not read ${filePath}: ${errorMessage(cause)}`,
        cause,
      });
    }
  },
  async findPaths(pattern) {
    try {
      const scannedPaths = new Glob(pattern).scan(".");
      return ok((await Array.fromAsync(scannedPaths)).toSorted());
    } catch (cause) {
      return fail({
        tag: "FileAccessError",
        path: pattern,
        message: `Could not discover rule files: ${errorMessage(cause)}`,
        cause,
      });
    }
  },
};
