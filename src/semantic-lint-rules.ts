import { noul } from "@typesafe-ai/sdk";
import type { SemanticLintFileAccess } from "./runtime/semantic-lint-files";
import type { SemanticLintFailure } from "./semantic-lint-errors";
import type { SemanticLintQuestionSet } from "./semantic-lint-evaluator";
import { metadataForRule } from "./semantic-lint-rule-profiles";
import { collect, fail, ok, type Result } from "./result";
import type { SemanticLintConfiguration } from "./semantic-lint-config";
export type SemanticLintRule = Readonly<{
  ruleId: string;
  rulePath: string;
  ruleTitle: string;
  definition: string;
  metadata: Readonly<{
    evaluator: "semantic" | "deterministic" | "review";
    scope: "source" | "change" | "repository";
    requiredEvidence: readonly string[];
    deterministicCheck?: string;
  }>;
}>;

function ruleFromDefinition(
  rulePath: string,
  index: number,
  definition: string,
  config: SemanticLintConfiguration["ruleFiles"],
): Result<SemanticLintRule, SemanticLintFailure> {
  if (definition.length === 0) {
    return fail({
      tag: "RuleFileError",
      path: rulePath,
      message: `Rule file is empty: ${rulePath}`,
    });
  }
  const heading = definition.match(/^#\s+(.+)$/m)?.[1];
  const ruleTitle = heading?.trim() ?? rulePath;
  const ruleOrdinal = index + config.firstRuleOrdinal;
  return ok({
    ruleId: `${config.ruleIdPrefix}${ruleOrdinal}`,
    rulePath,
    ruleTitle,
    definition,
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
