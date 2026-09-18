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
hunk, related source, and relevance before final evaluation. Configuration caps
each request at 32,000 bytes, each evidence snippet at 6,000 bytes, and each
final evaluation at six evidence items.

The previous CLI sent every complete changed source through every rule and had
no request-size bound. The new stages add internal code but make request growth
bounded, run independent rules concurrently, and model failures in Effect's
typed error channel. Types live with their owning rule, evidence, routing, or
report module; there is no shared type barrel.

`src/routing/` groups the four stages. `choice.ts` selects candidates,
`context.ts` expands repository relations, `evaluate-rule.ts` evaluates one
rule, `route-rules.ts` runs independent rules concurrently, and
`semantic-lint-evaluation.ts` combines routed, deterministic, and
evidence-dependent review rules. Combining them would create one module over
1,000 lines; splitting another stage would not create a useful concept.

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
