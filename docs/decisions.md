# Architecture decisions

Owner: Andrue Anderson

## ADR 1: Keep one Bun CLI

**Status:** accepted

The repository has one deployable and no reusable library. Keep one root package.
Revisit when a second deployable or independently consumed library exists.

## ADR 2: Route bounded evidence

**Status:** accepted

The API rejects requests above a fixed byte budget, while repository and change
rules need more than one source file. The routing pipeline narrows domain, path,
hunk, related source, and relevance before final evaluation. The runtime caps
each request at 32,000 bytes, each evidence snippet at 6,000 bytes, and each
final evaluation at six evidence items.

The previous CLI sent every complete changed source through every rule and had
no request-size bound. The routing stages bound request growth. A scheduler
groups pending judgments by model, request options, and byte-identical state,
then sends their questions together up to the request byte limit. A shared
semaphore bounds physical requests. Each answer returns to its originating rule,
and distributed usage values sum to the service response totals.

`src/semantic-lint/routing/` owns the stages. `choice.ts` selects candidates,
`context.ts` expands repository relations, `evaluate-rule.ts` evaluates one
rule, `batch.ts` packs shared-state questions, and `route-rules.ts` runs rule
pipelines concurrently.

Revisit if the service accepts complete repositories within an explicit bounded
contract.

## ADR 3: Model operations with Effect

**Status:** accepted

Runtime adapters use `Effect.try` or `Effect.tryPromise` and return specific
tagged failures. Application functions compose lazy Effects. Only executable
and test boundaries run them.

## ADR 4: Pin one formatter and linter

**Status:** accepted

The repository previously had no formatter or static lint check. Biome is the
only added tool dependency. One pinned binary enforces both checks in
`bun run check`; Bun and TypeScript do not provide either check.

## ADR 5: Validate external responses locally

**Status:** accepted

TypeSafe and subprocess JSON enter as `unknown`. Small local schemas validate
the exact fields and probability ranges consumed by the application. This keeps
runtime validation without adding a general schema dependency.

## ADR 6: Keep user rules declarative

**Status:** accepted

Built-in and user-defined rules use the same Markdown format under `rules/`.
The CLI discovers them recursively. A rule needs YAML path globs and a Markdown
definition; no registration file or executable plugin API is required.

## ADR 7: Compile evaluation policy into the CLI

**Status:** accepted

Request limits, routing bounds, prompts, formatting, and exit codes are tool
implementation details. Keep them in source rather than distributing a project
configuration file. User controls remain CLI options.
