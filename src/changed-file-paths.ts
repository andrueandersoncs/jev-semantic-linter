import { $ } from "bun";
import {
  type Result,
  valuesFromResults,
} from "./semantic-lint-result";

function gitPathsFromOutput(
  label: string,
  output: $.ShellOutput,
): Result<readonly string[]> {
  if (output.exitCode !== 0) {
    const detail = output.stderr.toString().trim();
    return { ok: false, error: `Could not list ${label}: ${detail}` };
  }
  const text = output.text();
  const paths = text.split("\0").filter((path) => path.length > 0);
  return { ok: true, value: paths };
}

function uniqueSortedPaths(paths: readonly string[]): readonly string[] {
  const sortedPaths = paths.toSorted();
  return sortedPaths.filter(
    (path, index) => path !== sortedPaths[index - 1],
  );
}

export async function changedFilePaths(): Promise<Result<readonly string[]>> {
  const trackedCommand =
    $`git diff --name-only --diff-filter=ACMR -z HEAD --`.quiet();
  const untrackedCommand =
    $`git ls-files --others --exclude-standard -z`.quiet();
  const trackedPromise = trackedCommand.nothrow();
  const untrackedPromise = untrackedCommand.nothrow();
  const [tracked, untracked] = await Promise.all([
    trackedPromise,
    untrackedPromise,
  ]);

  const pathGroups = valuesFromResults([
    gitPathsFromOutput("tracked changes", tracked),
    gitPathsFromOutput("untracked files", untracked),
  ]);
  if (!pathGroups.ok) {
    return pathGroups;
  }

  const paths = uniqueSortedPaths(pathGroups.value.flat());
  return { ok: true, value: paths };
}
