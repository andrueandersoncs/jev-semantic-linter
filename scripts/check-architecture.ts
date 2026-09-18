import { Console, Effect } from "effect";
import { errorMessage } from "../src/error-message";

type FindingRecord = Readonly<{
  ruleTitle: string;
  evaluator: string;
  classification: string;
}>;

type DocumentRecord = Readonly<{
  findings?: readonly FindingRecord[];
}>;

function isFinding(value: unknown): value is FindingRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    "ruleTitle" in value &&
    typeof value.ruleTitle === "string" &&
    "evaluator" in value &&
    typeof value.evaluator === "string" &&
    "classification" in value &&
    typeof value.classification === "string"
  );
}

function isDocument(value: unknown): value is DocumentRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return (
    !("findings" in value) ||
    value.findings === undefined ||
    (Array.isArray(value.findings) && value.findings.every(isFinding))
  );
}

function architectureDocuments(
  output: string,
): Effect.Effect<readonly DocumentRecord[], string> {
  return Effect.flatMap(
    Effect.try({
      try: () => JSON.parse(output) as unknown,
      catch: (cause) =>
        `Architecture check received invalid JSON: ${errorMessage(cause)}`,
    }),
    (value) =>
      Array.isArray(value) && value.every(isDocument)
        ? Effect.succeed(value)
        : Effect.fail("Architecture check received invalid output."),
  );
}

const program = Effect.gen(function* () {
  const semanticLint = yield* Effect.try({
    try: () =>
      Bun.spawn(["bun", "run", "semantic-lint", "--dry-run", "--json"], {
        stdout: "pipe",
        stderr: "inherit",
      }),
    catch: (cause) => `Could not start semantic-lint: ${errorMessage(cause)}`,
  });
  const [output, exitCode] = yield* Effect.all(
    [
      Effect.promise(() => new Response(semanticLint.stdout).text()),
      Effect.promise(() => semanticLint.exited),
    ],
    { concurrency: "unbounded" },
  );
  if (exitCode !== 0) {
    return yield* Effect.fail(
      `Architecture check could not run semantic-lint (${exitCode}).`,
    );
  }
  const documents = yield* architectureDocuments(output);
  const violations = documents
    .flatMap((document) => document.findings ?? [])
    .filter(
      (finding) =>
        finding.evaluator === "deterministic" &&
        finding.classification === "violation",
    );
  if (violations.length === 0) {
    return 0;
  }
  yield* Effect.forEach(
    violations,
    (violation) =>
      Console.error(`Architecture violation: ${violation.ruleTitle}`),
    { discard: true },
  );
  return 1;
});

const exitCode = await Effect.runPromise(
  Effect.matchEffect(program, {
    onFailure: (message) => Effect.map(Console.error(message), () => 1),
    onSuccess: Effect.succeed,
  }),
);
process.exit(exitCode);
