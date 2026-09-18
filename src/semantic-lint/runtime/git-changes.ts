import { $ } from "bun";
import { Effect } from "effect";
import { errorMessage } from "../../error-message";
import { GitAccessError } from "../errors";

type GitEvidenceKind =
  | "tracked changes"
  | "untracked files"
  | "repository files"
  | "deleted repository files"
  | "working-tree diff";

type GitCommand = () => $.ShellPromise;

function pathsFromNullSeparatedText(text: string): readonly string[] {
  return text.split("\0").filter((path) => path.length > 0);
}

function changedPathsFromGitText(
  trackedChanges: string,
  untrackedFiles: string,
): readonly string[] {
  const paths = [
    ...pathsFromNullSeparatedText(trackedChanges),
    ...pathsFromNullSeparatedText(untrackedFiles),
  ];
  const sortedPaths = paths.toSorted();
  return sortedPaths.filter((path, index) => path !== sortedPaths[index - 1]);
}

function gitOutputText(
  operation: GitEvidenceKind,
  command: GitCommand,
): Effect.Effect<string, GitAccessError> {
  return Effect.flatMap(
    Effect.tryPromise({
      try: () => command().quiet().nothrow(),
      catch: (cause) =>
        new GitAccessError({
          operation,
          message: `Could not read ${operation}: ${errorMessage(cause)}`,
          cause,
        }),
    }),
    (result) => {
      if (result.exitCode === 0) {
        return Effect.succeed(result.text());
      }
      const detail = result.stderr.toString().trim();
      return Effect.fail(
        new GitAccessError({
          operation,
          message: `Could not read ${operation}: ${detail}`,
          cause: result,
        }),
      );
    },
  );
}

export type SemanticLintGitSnapshot = Readonly<{
  changedPaths: readonly string[];
  repositoryPaths: readonly string[];
  diff: string;
}>;

export type SemanticLintGitAccess = Readonly<{
  repositorySnapshot: () => Effect.Effect<
    SemanticLintGitSnapshot,
    GitAccessError
  >;
}>;

const changedFilePaths = Effect.map(
  Effect.all(
    [
      gitOutputText(
        "tracked changes",
        () => $`git diff --name-only -z HEAD --`,
      ),
      gitOutputText(
        "untracked files",
        () => $`git ls-files --others --exclude-standard -z`,
      ),
    ],
    { concurrency: "unbounded" },
  ),
  ([tracked, untracked]) => changedPathsFromGitText(tracked, untracked),
);

const repositoryFilePaths = Effect.map(
  Effect.all(
    [
      gitOutputText(
        "repository files",
        () => $`git ls-files --cached --others --exclude-standard -z`,
      ),
      gitOutputText(
        "deleted repository files",
        () => $`git ls-files --deleted -z`,
      ),
    ],
    { concurrency: "unbounded" },
  ),
  ([repository, deleted]) => {
    const deletedPaths = new Set(changedPathsFromGitText(deleted, ""));
    return changedPathsFromGitText(repository, "").filter(
      (path) => !deletedPaths.has(path),
    );
  },
);

const workingTreeDiff = gitOutputText(
  "working-tree diff",
  () => $`git diff --no-ext-diff --unified=3 HEAD --`,
);

/** Git process boundary. */
export const gitChanges: SemanticLintGitAccess = {
  repositorySnapshot: () =>
    Effect.map(
      Effect.all(
        {
          changedPaths: changedFilePaths,
          repositoryPaths: repositoryFilePaths,
          diff: workingTreeDiff,
        },
        { concurrency: "unbounded" },
      ),
      ({ changedPaths, repositoryPaths, diff }) => ({
        changedPaths,
        repositoryPaths,
        diff,
      }),
    ),
};
