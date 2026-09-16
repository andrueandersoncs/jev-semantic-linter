# Semantic linter playground

This playground batches English lint rules into one TypeSafe System One request.
Each Markdown file under `rules/` defines one rule and becomes a Noul question:
the returned value is the probability that the source violates that rule.

## Setup

```bash
bun install
export TYPESAFE_API_KEY="..."
```

Runtime policy values, rule discovery, output formatting, and exit codes live in
`semantic-lint.config.json` rather than as unexplained literals in the linter.

## Add a rule

Create a Markdown file anywhere under `rules/`:

```markdown
# Do not log secrets

Authentication tokens, passwords, API keys, and other secrets must not be
written to application logs.
```

The first level-one heading is used as the diagnostic title. The entire document
is sent as the rule definition, so it can include rationale, exceptions, and
examples. Rule files are discovered recursively through `rules/**/*.md`.

## Run

```bash
bun run semantic-lint examples/insecure-handler.ts
```

The default violation threshold is `0.7`. Probabilities at or below `0.4` pass;
values between `0.4` and `0.7` are reported for review. Any violation or review
result exits with status 1.

Useful options:

```bash
# Inspect the exact batched request without an API call
bun run semantic-lint examples/insecure-handler.ts --dry-run

# Machine-readable output and a stricter violation threshold
bun run semantic-lint examples/insecure-handler.ts --json --threshold 0.8
```
