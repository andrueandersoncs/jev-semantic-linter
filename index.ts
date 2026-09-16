import { Glob } from "bun";
import {
  noul,
  TypeSafeClient,
  type NoulQuestion,
  type NoulResponse,
} from "@typesafe-ai/sdk";

const DEFAULT_THRESHOLD = 0.7;
const RULES_PATTERN = "rules/**/*.md";

type Rule = {
  id: string;
  path: string;
  title: string;
  text: string;
};

type Options = {
  sourcePath: string;
  threshold: number;
  model?: string;
  json: boolean;
  dryRun: boolean;
};

type Finding = Rule & {
  probability: number;
  status: "violation" | "review" | "pass";
};

const USAGE = [
  "Usage: bun run index.ts <source-file> [options]",
  "",
  "Options:",
  `  --threshold <number>  Violation probability threshold (default: ${DEFAULT_THRESHOLD})`,
  "  --model <name>        TypeSafe model override (default: SDK default)",
  "  --json                Print machine-readable results",
  "  --dry-run             Print the TypeSafe request without sending it",
  "  --help                Show this help",
].join("\n");

function takeValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function parseArgs(args: string[]): Options | null {
  if (args.includes("--help")) {
    return null;
  }

  const positional: string[] = [];
  let threshold = DEFAULT_THRESHOLD;
  let model: string | undefined;
  let json = false;
  let dryRun = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;

    if (arg === "--threshold") {
      threshold = Number(takeValue(args, index, arg));
      index += 1;
    } else if (arg === "--model") {
      model = takeValue(args, index, arg);
      index += 1;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length !== 1) {
    throw new Error("Expected one source file");
  }
  if (!Number.isFinite(threshold) || threshold <= 0.5 || threshold > 1) {
    throw new Error("--threshold must be greater than 0.5 and at most 1");
  }

  return {
    sourcePath: positional[0]!,
    threshold,
    model,
    json,
    dryRun,
  };
}

async function readText(path: string, label: string): Promise<string> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`${label} does not exist: ${path}`);
  }
  return file.text();
}

async function loadRules(): Promise<Rule[]> {
  const paths: string[] = [];
  for await (const path of new Glob(RULES_PATTERN).scan(".")) {
    paths.push(path);
  }
  paths.sort();

  if (paths.length === 0) {
    throw new Error(`No rule files match ${RULES_PATTERN}`);
  }

  return Promise.all(
    paths.map(async (path, index) => {
      const text = (await readText(path, "Rule file")).trim();
      if (text.length === 0) {
        throw new Error(`Rule file is empty: ${path}`);
      }

      const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? path;
      return { id: `rule_${index + 1}`, path, title, text };
    }),
  );
}

function buildQuestions(rules: Rule[]): Record<string, NoulQuestion> {
  return Object.fromEntries(
    rules.map((rule) => [
      rule.id,
      noul(
        {
          task: "Does `code.source` violate the semantic lint rule?",
          rule: {
            source: rule.path,
            definition: rule.text,
          },
          guidance:
            "Judge observable behavior, not naming or formatting. A violation requires evidence in the supplied code.",
        },
        {
          true: "At least one behavior in the code violates the rule.",
          false:
            "The code complies with the rule, or the rule does not apply to this code.",
        },
      ),
    ]),
  );
}

function classify(
  rule: Rule,
  answer: NoulResponse,
  threshold: number,
): Finding {
  const status =
    answer.noul >= threshold
      ? "violation"
      : answer.noul <= 1 - threshold
        ? "pass"
        : "review";

  return { ...rule, probability: answer.noul, status };
}

function printHuman(findings: Finding[]): void {
  for (const finding of findings) {
    const marker =
      finding.status === "violation"
        ? "error"
        : finding.status === "review"
          ? "review"
          : "pass";
    const probability = `${Math.round(finding.probability * 100)}%`.padStart(4);
    console.log(
      `[${marker.padEnd(6)} ${probability}] ${finding.title} (${finding.path})`,
    );
  }

  const violations = findings.filter(
    (finding) => finding.status === "violation",
  ).length;
  const reviews = findings.filter(
    (finding) => finding.status === "review",
  ).length;
  console.log(
    `\n${violations} violation(s), ${reviews} need review, ${findings.length - violations - reviews} passed`,
  );
}

async function run(options: Options): Promise<number> {
  const [source, rules] = await Promise.all([
    readText(options.sourcePath, "Source file"),
    loadRules(),
  ]);
  const questions = buildQuestions(rules);
  const state = {
    code: {
      filename: options.sourcePath,
      language: options.sourcePath.split(".").at(-1) ?? "unknown",
      source,
    },
  };
  const request = {
    state,
    questions,
    ...(options.model ? { model: options.model } : {}),
  };

  if (options.dryRun) {
    console.log(JSON.stringify(request, null, 2));
    return 0;
  }

  const client = new TypeSafeClient();
  const response = await client.systemOne(request);
  const findings = rules.map((rule) => {
    const answer = response.answers[rule.id];
    if (!answer) {
      throw new Error(`TypeSafe returned no answer for ${rule.id}`);
    }
    return classify(rule, answer, options.threshold);
  });

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          source: options.sourcePath,
          model: response.model,
          threshold: options.threshold,
          findings,
          usage: response.usage,
        },
        null,
        2,
      ),
    );
  } else {
    printHuman(findings);
  }

  return findings.some((finding) => finding.status !== "pass") ? 1 : 0;
}

if (import.meta.main) {
  try {
    const options = parseArgs(Bun.argv.slice(2));
    if (!options) {
      console.log(USAGE);
    } else {
      process.exitCode = await run(options);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`semantic-lint: ${message}`);
    process.exitCode = 2;
  }
}