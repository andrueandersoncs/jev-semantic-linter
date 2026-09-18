import { Glob } from "bun";
import { noul } from "@typesafe-ai/sdk";
import { Effect } from "effect";
import type { SemanticLintFileAccess } from "./runtime/files";
import { RuleFileError, type SemanticLintFailure } from "./errors";
import type { SemanticLintQuestionSet } from "./evaluator";
import { metadataForRule } from "./rule-profiles";
type SemanticLintRuleDocument = Readonly<{
  definition: string;
  globs: readonly string[];
}>;

const ruleFilePattern = "rules/**/*.md";
const firstRuleOrdinal = 1;
const ruleIdPrefix = "rule_";

const compiledRuleGlobs = new WeakMap<
  SemanticLintRule,
  readonly InstanceType<typeof Glob>[]
>();

export type SemanticLintRule = Readonly<{
  ruleId: string;
  rulePath: string;
  ruleTitle: string;
  definition: string;
  globs: readonly string[];
  metadata: Readonly<{
    evaluator: "semantic" | "deterministic" | "review";
    scope: "source" | "change" | "repository";
    requiredEvidence: readonly string[];
    deterministicCheck?: string;
  }>;
}>;

function ruleFileError(rulePath: string, message: string): RuleFileError {
  return new RuleFileError({
    path: rulePath,
    message: `${message}: ${rulePath}`,
  });
}

function ruleDocumentFromSource(
  rulePath: string,
  source: string,
): Effect.Effect<SemanticLintRuleDocument, RuleFileError> {
  if (source.length === 0) {
    return Effect.fail(ruleFileError(rulePath, "Rule file is empty"));
  }
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (frontmatter?.[1] === undefined) {
    return Effect.fail(ruleFileError(rulePath, "Rule file has no frontmatter"));
  }
  const metadata = Effect.try({
    try: () => Bun.YAML.parse(frontmatter[1] as string) as unknown,
    catch: () => ruleFileError(rulePath, "Rule file has invalid frontmatter"),
  });
  return Effect.flatMap(metadata, (parsed) => {
    const globs =
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      "globs" in parsed
        ? parsed.globs
        : undefined;
    if (
      !Array.isArray(globs) ||
      globs.length === 0 ||
      !globs.every((glob) => typeof glob === "string" && glob.length > 0)
    ) {
      return Effect.fail(
        ruleFileError(rulePath, "Rule frontmatter requires non-empty globs"),
      );
    }
    const validatedGlobs = Effect.try({
      try: () => {
        for (const glob of globs) {
          new Glob(glob);
        }
        return globs as readonly string[];
      },
      catch: () =>
        ruleFileError(rulePath, "Rule frontmatter has an invalid glob"),
    });
    return Effect.flatMap(validatedGlobs, (validGlobs) => {
      const definition = source.slice(frontmatter[0].length).trim();
      return definition.length === 0
        ? Effect.fail(ruleFileError(rulePath, "Rule definition is empty"))
        : Effect.succeed({ definition, globs: validGlobs });
    });
  });
}

export function ruleMatchesPath(rule: SemanticLintRule, path: string): boolean {
  const cached = compiledRuleGlobs.get(rule);
  const globs = cached ?? rule.globs.map((glob) => new Glob(glob));
  if (cached === undefined) {
    compiledRuleGlobs.set(rule, globs);
  }
  return globs.some((glob) => glob.match(path));
}

function ruleFromDefinition(
  rulePath: string,
  index: number,
  source: string,
): Effect.Effect<SemanticLintRule, RuleFileError> {
  return Effect.map(ruleDocumentFromSource(rulePath, source), (document) => {
    const heading = document.definition.match(/^#\s+(.+)$/m)?.[1];
    const ruleTitle = heading?.trim() ?? rulePath;
    const ruleOrdinal = index + firstRuleOrdinal;
    return {
      ruleId: `${ruleIdPrefix}${ruleOrdinal}`,
      rulePath,
      ruleTitle,
      definition: document.definition,
      globs: document.globs,
      metadata: metadataForRule(rulePath),
    };
  });
}

function ruleFromFile(
  files: SemanticLintFileAccess,
  rulePath: string,
  index: number,
): Effect.Effect<SemanticLintRule, SemanticLintFailure> {
  return Effect.flatMap(files.readText(rulePath), (source) =>
    ruleFromDefinition(rulePath, index, source.trim()),
  );
}

/** Loads Markdown rules in stable path order. */
export function rulesFromFiles(
  files: SemanticLintFileAccess,
): Effect.Effect<readonly SemanticLintRule[], SemanticLintFailure> {
  return Effect.flatMap(files.findPaths(ruleFilePattern), (found) => {
    if (found.length === 0) {
      return Effect.fail(
        new RuleFileError({
          path: ruleFilePattern,
          message: `No rule files match ${ruleFilePattern}`,
        }),
      );
    }
    return Effect.forEach(
      found,
      (rulePath, index) => ruleFromFile(files, rulePath, index),
      { concurrency: "unbounded" },
    );
  });
}

export function questionsFromRules(
  rules: readonly SemanticLintRule[],
): SemanticLintQuestionSet {
  return Object.fromEntries(
    rules.map((rule) => [
      rule.ruleId,
      noul(
        {
          task: "Does the identified candidate violate the supplied semantic lint rule?",
          rule: {
            source: rule.rulePath,
            definition: rule.definition,
            scope: rule.metadata.scope,
            requiredEvidence: [...rule.metadata.requiredEvidence],
          },
          guidance:
            "Judge only the identified candidate. Use the supplied repository and change evidence when the rule requires comparison. The caller handles applicability and evidence sufficiency before asking this question.",
        },
        {
          true: "The candidate contains a concrete violation supported by the supplied evidence.",
          false:
            "The supplied evidence shows no concrete violation in the candidate.",
        },
      ),
    ]),
  );
}
