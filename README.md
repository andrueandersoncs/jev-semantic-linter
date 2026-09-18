# Semantic lint playground

A CLI that checks natural-language engineering rules against the current Git
change and repository.

It uses three evaluators:

- deterministic code for dependency, workspace, filename, Bun, test, and
  TypeScript configuration rules;
- layered TypeSafe Choice routing over evidence domains, paths, and diff hunks;
- independent TypeSafe Noul relevance and rule judgments;
- explicit review context for rules that require requirements, rationale, or
  measurements.

## Setup

```bash
bun install
export TYPESAFE_API_KEY="..."
```

The API key is needed for live semantic evaluation. Dry runs do not call the
API.

## Run

```bash
bun run semantic-lint
```

The CLI:

1. parses changed, untracked, and deleted files into stable diff hunks;
2. loads `rules/**/*.md`, keeps rules whose frontmatter globs match a changed
   path, and assigns each rule an evaluator and scope;
3. runs exact repository checks in code;
4. uses Choice probability distributions to retain a beam of likely domains,
   paths, and hunks;
5. expands selected hunks through imports, importers, tests, manifests, and
   configuration;
6. uses independent Nouls to remove irrelevant evidence;
7. evaluates each rule once against bounded selected evidence.

No semantic judgment receives the complete Git diff or repository. Large
candidate sets are routed through bounded buckets.

## Rule globs

Every rule starts with glob frontmatter:

```yaml
---
globs:
  - "**/*.{ts,tsx}"
---
```

The rule is skipped when no changed path matches. Routing considers only
matching changed files.

## Custom rules

Add a Markdown file anywhere under `rules/`. No registration is required.

```md
---
globs:
  - "src/**/*.ts"
---
# Do not commit debugger statements

Remove debugger statements.
```

The YAML frontmatter selects changed paths. The Markdown body defines the rule
for the semantic evaluator. Empty files, invalid frontmatter, missing globs, and
invalid globs stop the run with exit code `2`.

## Review context

Some rules cannot be verified from source and Git alone. Without external
context, they return `insufficient_evidence`.

Supply requirements, design rationale, or measurements with:

```bash
bun run semantic-lint --review-context review-context.txt
```

The context is evaluated only by rules whose profiles require external
requirements, rationale, or measurements.

## Results

Each rule result has one classification:

| Classification | Meaning | Fails a live run |
| --- | --- | --- |
| `pass` | Supplied evidence shows no violation | No |
| `not_applicable` | No matching candidate exists | No |
| `review` | Violation probability is above the pass boundary | Yes |
| `violation` | Violation probability reaches the configured threshold | Yes |
| `insufficient_evidence` | Required evidence was not supplied | Yes |

With the default thresholds:

- `<= 0.4`: `pass`
- `> 0.4` and `< 0.7`: `review`
- `>= 0.7`: `violation`

Deterministic findings do not have a probability. Semantic findings include
selected source spans and their relevance probabilities. JSON output also
includes every routing decision and the final evidence IDs.

## Options

```text
--threshold <number>     Violation probability threshold
--model <name>           TypeSafe model override
--review-context <path>  Requirements, rationale, and measurements
--json                   Print machine-readable results
--dry-run                Print the evaluation plan without API calls
--help                   Show help
```

Examples:

```bash
bun run semantic-lint --dry-run
bun run semantic-lint --model jev-latest
bun run semantic-lint --json --threshold 0.8
```

Dry-run output contains:

- local deterministic and evidence-sufficiency results;
- routing layers and limits;
- every semantic rule scheduled for routing;
- stable changed-file and hunk IDs.

Later requests depend on earlier Choice distributions, so dry runs describe
their construction instead of fabricating downstream requests.

Dry runs always exit successfully.

## Evaluation policy

Routing limits, evidence bounds, prompts, output formatting, and exit codes are
part of the tool. They are compiled into the CLI instead of exposed as project
configuration. Users control the violation threshold, model, and review context
through command-line options.

Every generated request is checked against an internal byte limit. Oversized
candidate sets are split or routed through another Choice layer. If no bounded,
relevant evidence remains, the rule returns `insufficient_evidence` instead of
a false pass or API error.

Independent judgments with the same model, request options, and byte-identical
state are sent as questions in one TypeSafe request. The scheduler splits
batches at the byte limit, maps each answer back to its rule, and enforces the
concurrent-request limit.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Passed, no changes, help, or dry run |
| `1` | Violation, review, or insufficient evidence |
| `2` | Handled CLI, Git, file, response, or API error |

## Architecture and ownership

[`ARCHITECTURE.md`](ARCHITECTURE.md) defines the public contract, dependency
direction, runtime boundaries, owners, decisions, and exception process.

## Project layout

```text
rules/                                  Natural-language rules
apps/semantic-lint.ts                    Deployable CLI entry
scripts/check-architecture.ts           Deterministic architecture gate
src/runtime/                            Git, filesystem, and TypeSafe boundaries
src/semantic-lint/config.ts             Internal evaluation policy
src/semantic-lint-rule-profiles.ts      Rule evaluator and scope metadata
src/semantic-lint-deterministic.ts      Exact repository checks
src/semantic-lint-evidence.ts           Diff parsing and evidence collection
src/routing/                            Layered evidence routing
src/routing/semantic-lint-evaluation.ts Rule partitioning and evaluation
src/semantic-lint-report.ts             User-facing reports
src/semantic-lint-run.ts                Git-to-evaluation orchestration
src/semantic-lint-command.ts            Argument parsing and command dispatch
src/semantic-lint-cli.ts                Console boundary
```
