# Semantic lint playground

An experimental CLI that applies natural-language engineering rules to every
changed file in the current Git worktree. Each rule becomes a
[TypeSafe Noul](https://docs.typesafe.ai/primitives/noul), and all rules for one
file are evaluated together in a single TypeSafe System One request.

The model returns the probability that each rule is violated. The CLI turns
those probabilities into `pass`, `review`, or `violation` results and an exit
code suitable for local checks or CI.

## How it works

For each run, the CLI:

1. Finds tracked changes relative to `HEAD` and untracked, non-ignored files.
2. Loads every Markdown rule matching `rules/**/*.md`.
3. Reads each changed file in full and builds one Noul question per rule.
4. Sends one TypeSafe request per changed file, processing files sequentially.
5. Prints every rule result, including passes, and fails if any result needs
   review or is a violation.

The CLI does not filter by extension. Any changed file selected by Git is read
as text and evaluated.

## Requirements

- [Bun](https://bun.sh/)
- Git, with the project inside a repository that has a `HEAD` commit
- A [TypeSafe API key](https://docs.typesafe.ai/sdk/javascript) for lint and
  dry-run commands

## Setup

Install dependencies:

```bash
bun install
```

Export your TypeSafe API key:

```bash
export TYPESAFE_API_KEY="..."
```

Bun also loads a project-root `.env` file automatically:

```dotenv
TYPESAFE_API_KEY=...
```

`.env` is ignored by this repository and must not be committed.

## Run

Run from the project root:

```bash
bun run semantic-lint
```

`bun run lint` is an alias for the same command.

### File selection

The selected paths are the sorted, deduplicated union of:

```bash
git diff --name-only --diff-filter=ACMR -z HEAD --
git ls-files --others --exclude-standard -z
```

This includes staged changes, unstaged changes, renames, and untracked files.
Deleted and ignored files are excluded. There is no positional argument for
linting a specific path.

If no paths are selected, the CLI prints:

```text
No changed files to lint.
```

and exits successfully.

## Rules

Each non-empty Markdown file under `rules/` defines one rule. Discovery is
recursive, so rules can be grouped into directories such as `rules/security/`.

```markdown
# Do not log secrets

Authentication tokens, passwords, API keys, and other secrets must not be
written to application logs.
```

The first level-one heading becomes the result title. If a rule has no
level-one heading, its path is used instead. The complete Markdown document is
sent as the rule definition, so it can contain rationale, exceptions, and
examples.

Rule paths are sorted lexicographically before IDs such as `rule_1` are
assigned. Because adding or renaming a rule can change these IDs, integrations
should identify rules by their `path`, not their generated `id`.

## Classification policy

With the defaults in `semantic-lint.config.json`, a Noul probability is
classified as follows:

| Probability | Status | Exit status |
| --- | --- | --- |
| `<= 0.4` | `pass` | Does not fail the run |
| `> 0.4` and `< 0.7` | `review` | Fails the run |
| `>= 0.7` | `violation` | Fails the run |

`--threshold` changes the violation boundary only; the pass maximum remains
`0.4`. A threshold must be greater than `0.5` and no greater than `1`.

These thresholds are project policy, not universal measures of model quality.
Evaluate them against representative code and consequences before relying on
the linter as a required gate.

## Options

```text
--threshold <number>  Violation probability threshold (default: 0.7)
--model <name>        TypeSafe model override (default: SDK default)
--json                Print machine-readable results
--dry-run             Print the TypeSafe request without sending it
--help                Show help
```

Examples:

```bash
# Inspect the exact batched requests without calling the API
bun run semantic-lint --dry-run

# Select a model explicitly
bun run semantic-lint --model jev-latest

# Emit JSON and move the violation boundary to 0.8
bun run semantic-lint --json --threshold 0.8
```

Dry-run output is a JSON array containing one request per selected file. It
makes no API request and always exits successfully after request construction.
The current implementation still constructs `TypeSafeClient`, so
`TYPESAFE_API_KEY` is required for dry runs.

Without `--model`, the TypeSafe SDK chooses its configured default model. With
the installed SDK, that is `jev-latest` unless `TYPESAFE_DEFAULT_MODEL`
overrides it.

## Output

Default output contains the source path followed by one line for every rule:

```text
Source file: src/example.ts
[pass 0.08] Do not log secrets (rules/security/do-not-log-secrets.md)
[review 0.52] Return errors as values (rules/errors-as-values.md)
```

`--json` emits an array of per-file reports. Each report contains:

- `source`
- the model returned by TypeSafe
- the active violation `threshold`
- every rule with its definition, probability, and status
- token `usage` returned by TypeSafe

When there are no changed files, the plain `No changed files to lint.` message
is used even with `--json` or `--dry-run`.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | All rules passed, no files changed, help shown, or dry run completed |
| `1` | At least one rule was classified as `review` or `violation` |
| `2` | A handled CLI, Git, file, rule, response, or API error occurred |

Human-readable errors are written to standard error with a `semantic-lint:`
prefix.

## Configuration

[`semantic-lint.config.json`](semantic-lint.config.json) contains the runtime
policy and presentation values:

- default violation threshold and pass maximum
- rule glob and generated ID format
- Noul task, guidance, and true/false criteria
- output labels and indentation
- success, findings, and runtime-error exit codes

The CLI has no separate configuration discovery mechanism; it imports this
project-root file directly.

## Operational constraints

- The entire contents of every selected file are sent to TypeSafe during a live
  run. Do not lint changed files that contain credentials or other data that
  must not leave the machine.
- Git-ignored untracked files are excluded, but changed tracked files are not
  protected by `.gitignore`.
- Results identify the source file and rule, not a line or source span.
- The CLI reports findings but does not modify files or suggest fixes.
- Rules are batched by file: one request contains every rule for one file, and
  separate files produce separate sequential requests.

## Project layout

```text
rules/                         Natural-language lint rules
semantic-lint.config.json      Policy, prompt, output, and exit-code settings
src/changed-file-paths.ts      Git-based file discovery
src/semantic-lint-rules.ts     Rule loading and Noul construction
src/semantic-lint-evaluation.ts
                               Request construction and TypeSafe evaluation
src/semantic-lint-report.ts    Human-readable and JSON reports
src/semantic-lint-cli.ts       Argument handling and process behavior
```
