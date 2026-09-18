import { Glob } from "bun";
import { noul } from "@typesafe-ai/sdk";
import type { SemanticLintFileAccess } from "./runtime/files";
import type { SemanticLintFailure } from "./errors";
import type { SemanticLintQuestionSet } from "./evaluator";
import { metadataForRule } from "./rule-profiles";
import { collect, fail, ok, type Result } from "../result";
import type { SemanticLintConfiguration } from "./config";
type SemanticLintRuleDocument = Readonly<{
  definition: string;
  globs: readonly string[];
}>;

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

function ruleFileError(rulePath: string, message: string): SemanticLintFailure {
  return {
    tag: "RuleFileError",
    path: rulePath,
    message: `${message}: ${rulePath}`,
  };
}

function ruleDocumentFromSource(
  rulePath: string,
  source: string,
): Result<SemanticLintRuleDocument, SemanticLintFailure> {
  if (source.length === 0) {
    return fail(ruleFileError(rulePath, "Rule file is empty"));
  }
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (frontmatter?.[1] === undefined) {
    return fail(ruleFileError(rulePath, "Rule file has no frontmatter"));
  }
  let metadata: unknown;
  try {
    metadata = Bun.YAML.parse(frontmatter[1]);
  } catch {
    return fail(ruleFileError(rulePath, "Rule file has invalid frontmatter"));
  }
  const globs =
    typeof metadata === "object" &&
    metadata !== null &&
    !Array.isArray(metadata) &&
    "globs" in metadata
      ? metadata.globs
      : undefined;
  if (
    !Array.isArray(globs) ||
    globs.length === 0 ||
    !globs.every((glob) => typeof glob === "string" && glob.length > 0)
  ) {
    return fail(
      ruleFileError(rulePath, "Rule frontmatter requires non-empty globs"),
    );
  }
  try {
    for (const glob of globs) {
      new Glob(glob);
    }
  } catch {
    return fail(
      ruleFileError(rulePath, "Rule frontmatter has an invalid glob"),
    );
  }
  const definition = source.slice(frontmatter[0].length).trim();
  return definition.length === 0
    ? fail(ruleFileError(rulePath, "Rule definition is empty"))
    : ok({ definition, globs });
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
  config: SemanticLintConfiguration["ruleFiles"],
): Result<SemanticLintRule, SemanticLintFailure> {
  const document = ruleDocumentFromSource(rulePath, source);
  if (!document.ok) {
    return document;
  }
  const heading = document.value.definition.match(/^#\s+(.+)$/m)?.[1];
  const ruleTitle = heading?.trim() ?? rulePath;
  const ruleOrdinal = index + config.firstRuleOrdinal;
  return ok({
    ruleId: `${config.ruleIdPrefix}${ruleOrdinal}`,
    rulePath,
    ruleTitle,
    definition: document.value.definition,
    globs: document.value.globs,
    metadata: metadataForRule(rulePath),
  });
}

async function ruleFromFile(
  files: SemanticLintFileAccess,
  rulePath: string,
  index: number,
  config: SemanticLintConfiguration["ruleFiles"],
): Promise<Result<SemanticLintRule, SemanticLintFailure>> {
  const source = await files.readText(rulePath);
  return source.ok
    ? ruleFromDefinition(rulePath, index, source.value.trim(), config)
    : source;
}

/** Loads configured rule files in stable path order. */
export async function rulesFromFiles(
  files: SemanticLintFileAccess,
  config: SemanticLintConfiguration["ruleFiles"],
): Promise<Result<readonly SemanticLintRule[], SemanticLintFailure>> {
  const found = await files.findPaths(config.ruleFilePattern);
  if (!found.ok) {
    return found;
  }
  if (found.value.length === 0) {
    return fail({
      tag: "RuleFileError",
      path: config.ruleFilePattern,
      message: `No rule files match ${config.ruleFilePattern}`,
    });
  }
  return collect(
    await Promise.all(
      found.value.map((rulePath, index) =>
        ruleFromFile(files, rulePath, index, config),
      ),
    ),
  );
}

export function questionsFromRules(
  rules: readonly SemanticLintRule[],
  config: SemanticLintConfiguration["questionPrompt"],
): SemanticLintQuestionSet {
  return Object.fromEntries(
    rules.map((rule) => [
      rule.ruleId,
      noul(
        {
          task: config.evaluationTask,
          rule: {
            source: rule.rulePath,
            definition: rule.definition,
            scope: rule.metadata.scope,
            requiredEvidence: [...rule.metadata.requiredEvidence],
          },
          guidance: config.evaluationGuidance,
        },
        {
          true: config.violationCriterion,
          false: config.complianceCriterion,
        },
      ),
    ]),
  );
}
