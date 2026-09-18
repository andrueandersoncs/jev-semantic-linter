# Architecture

The deployable Bun CLI lives at `apps/semantic-lint.ts`. Its public interface is
the `semantic-lint` command. Developers and CI are its consumers; `src/` modules
are private implementation details.

The private root package owns this single app and its toolchain. Add a package
under `packages/` only when independently consumed library code exists.

## Dependency direction

```text
apps/semantic-lint.ts
  -> command and reporting
  -> evaluation and routing
  -> evidence, rules, and deterministic checks
  -> runtime adapters
  -> Bun, TypeSafe SDK, and Git
```

Core rule and evidence modules do not import CLI or runtime adapters. Runtime
adapters own filesystem, Git, process, and TypeSafe network I/O. The composition
root passes those adapters into the command as plain Promise-based services.
Relative import cycles and cross-workspace internal imports are prohibited.

## Runtime contract

- Bun 1.4.2 runs the CLI and reads files.
- Git must be available on `PATH`.
- A TypeSafe API key is required for live evaluation, not `--dry-run`.
- TypeSafe calls occur only through `runtime/typesafe-evaluator.ts`.
- Git commands occur only through `runtime/git-changes.ts`.
- Rule evaluation receives bounded evidence. It never receives the complete raw
  Git diff or repository.

## Commands

```bash
bun run semantic-lint       # run the CLI
bun run test                # test observable behavior
bun run typecheck           # check TypeScript
bun run format:check        # check formatting
bun run lint                # run static lint rules
bun run check:architecture  # enforce repository rules without TypeSafe calls
bun run check               # run every required check
```

## Dependencies

- `@typesafe-ai/sdk`: required client and typed Choice and Noul contracts for
  the TypeSafe API.
- `@biomejs/biome`: the pinned formatter and static linter used by the required
  `check` command; Bun and TypeScript do not provide these checks.
- `typescript` and `@types/bun`: the compiler and Bun runtime declarations used
  by `typecheck`.

The runtime has one external dependency: the TypeSafe client. Three small
service interfaces cover filesystem, Git, and TypeSafe boundaries without a
dependency-injection framework.

## Safeguards

- Git evidence includes tracked and untracked paths, then sorts and deduplicates
  them before routing.
- Missing, unreadable, empty, and invalid rule files return typed errors. Each
  rule declares at least one path glob in YAML frontmatter.
- TypeSafe and architecture-check JSON is shape-checked before use.
- `bun run check` runs formatting, static analysis, types, behavior tests, and
  the deterministic architecture check.

## Ownership

| Boundary | Owner | Purpose | Public API | Consumers | Runtime |
| --- | --- | --- | --- | --- | --- |
| Root package | Andrue Anderson | Private workspace and toolchain | Package scripts | Developers and CI | Bun 1.4.2 |
| `apps/semantic-lint.ts` | Andrue Anderson | Deployable semantic lint CLI | `semantic-lint` command | Developers and CI | Bun 1.4.2, Git, TypeSafe |
| `src/runtime/` | Andrue Anderson | External I/O adapters | Capability interfaces | CLI composition root | Bun 1.4.2 |
| `src/routing/` | Andrue Anderson | Bounded evidence selection and evaluation | `routeAndEvaluateRules` | Evaluation orchestrator | Bun 1.4.2 and TypeSafe |
| `rules/` | Andrue Anderson | Engineering policy | Markdown rule files | Semantic lint evaluator | Filesystem |

There are no architectural exceptions. A future exception must be recorded here
with its reason, owner, and removal condition before the violating code merges.

## Decisions

Consequential decisions are recorded in
[`docs/decisions.md`](docs/decisions.md). Andrue Anderson owns each current
decision and its revisit condition.
