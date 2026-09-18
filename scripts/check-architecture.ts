import { errorMessage } from "../src/error-message";
import { fail, ok } from "../src/result";

type FindingRecord = Readonly<{
  ruleTitle: string;
  evaluator: string;
  classification: string;
}>;

type DocumentRecord = Readonly<{
  findings?: readonly FindingRecord[];
}>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFinding(value: unknown): value is FindingRecord {
  return (
    isRecord(value) &&
    typeof value.ruleTitle === "string" &&
    typeof value.evaluator === "string" &&
    typeof value.classification === "string"
  );
}

function isDocument(value: unknown): value is DocumentRecord {
  return (
    isRecord(value) &&
    (value.findings === undefined ||
      (Array.isArray(value.findings) && value.findings.every(isFinding)))
  );
}

function architectureDocuments(output: string) {
  try {
    const value: unknown = JSON.parse(output);
    return Array.isArray(value) && value.every(isDocument)
      ? ok(value)
      : fail("Architecture check received invalid output.");
  } catch (cause) {
    return fail(
      `Architecture check received invalid JSON: ${errorMessage(cause)}`,
    );
  }
}

const semanticLint = Bun.spawn(
  ["bun", "run", "semantic-lint", "--dry-run", "--json"],
  { stdout: "pipe", stderr: "inherit" },
);
const [output, exitCode] = await Promise.all([
  new Response(semanticLint.stdout).text(),
  semanticLint.exited,
]);
if (exitCode !== 0) {
  console.error(
    `Architecture check could not run semantic-lint (${exitCode}).`,
  );
  process.exit(exitCode);
}

const parsedDocuments = architectureDocuments(output);
if (!parsedDocuments.ok) {
  console.error(parsedDocuments.error);
  process.exit(1);
}
const violations = parsedDocuments.value
  .flatMap((document) => document.findings ?? [])
  .filter(
    (finding) =>
      finding.evaluator === "deterministic" &&
      finding.classification === "violation",
  );
if (violations.length > 0) {
  for (const violation of violations) {
    console.error(`Architecture violation: ${violation.ruleTitle}`);
  }
  process.exit(1);
}
