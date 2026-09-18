import { Glob } from "bun";
import { Effect } from "effect";
import { errorMessage } from "../../error-message";
import { FileAccessError } from "../errors";

export type SemanticLintFileAccess = Readonly<{
  readText: (filePath: string) => Effect.Effect<string, FileAccessError>;
  findPaths: (
    pattern: string,
  ) => Effect.Effect<readonly string[], FileAccessError>;
}>;

/** Bun filesystem boundary. */
export const semanticLintFiles: SemanticLintFileAccess = {
  readText: (filePath) =>
    Effect.tryPromise({
      try: () => Bun.file(filePath).text(),
      catch: (cause) =>
        new FileAccessError({
          path: filePath,
          message: `Could not read ${filePath}: ${errorMessage(cause)}`,
          cause,
        }),
    }),
  findPaths: (pattern) =>
    Effect.tryPromise({
      try: async () => {
        const scannedPaths = new Glob(pattern).scan(".");
        return (await Array.fromAsync(scannedPaths)).toSorted();
      },
      catch: (cause) =>
        new FileAccessError({
          path: pattern,
          message: `Could not discover rule files: ${errorMessage(cause)}`,
          cause,
        }),
    }),
};
