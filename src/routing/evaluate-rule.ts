import { noul, type EntryType, type Usage } from "@typesafe-ai/sdk";
import { noulResponse } from "../runtime/typesafe-response";
import type { TypeSafeEvaluationError } from "../semantic-lint-errors";
import {
  findingFromAnswer,
  type SemanticLintFinding,
} from "../semantic-lint-findings";
import type { SemanticLintEvaluationRequest } from "../semantic-lint-evaluator";
import { questionsFromRules } from "../semantic-lint-rules";
import { collect, fail, ok, type Result } from "../result";
import type {
  SemanticLintEvidence,
  SemanticLintRepositoryEvidence,
} from "../semantic-lint-evidence";
import type { SemanticLintRule } from "../semantic-lint-rules";
import {
  emptyRoutingUsage,
  mergeRoutingUsage,
  routeRuleHunks,
  type RoutingRequestContext,
  type RoutingUsage,
  type SemanticLintRoutingDecision,
} from "./choice";
import { expandEvidence, type RepositoryRelations } from "./context";

export type RoutedRuleResult = Readonly<{
  findings: readonly SemanticLintFinding[];
  usage: RoutingUsage;
}>;

type RelevanceResult = Readonly<{
  evidence: readonly SemanticLintEvidence[];
  decisions: readonly SemanticLintRoutingDecision[];
  usage: RoutingUsage;
}>;

function requestBytes(request: SemanticLintEvaluationRequest): number {
  return Buffer.byteLength(JSON.stringify(request));
}

function usageFromResponse(model: string, usage: Usage): RoutingUsage {
  return {
    model,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
  };
}

function evidenceState(candidates: readonly SemanticLintEvidence[]): EntryType {
  return candidates.map((candidate) => ({
    id: candidate.id ?? null,
    kind: candidate.kind ?? null,
    relation: candidate.relation ?? null,
    path: candidate.path,
    startLine: candidate.startLine ?? null,
    endLine: candidate.endLine ?? null,
    snippet: candidate.snippet ?? null,
    relevanceProbability: candidate.relevanceProbability ?? null,
  }));
}

function relevanceRequest(
  rule: SemanticLintRule,
  candidates: readonly SemanticLintEvidence[],
  context: RoutingRequestContext,
): SemanticLintEvaluationRequest {
  const state: EntryType = {
    rule: {
      source: rule.rulePath,
      definition: rule.definition,
      scope: rule.metadata.scope,
      requiredEvidence: [...rule.metadata.requiredEvidence],
    },
    evidenceCandidates: evidenceState(candidates),
  };
  return {
    state,
    questions: Object.fromEntries(
      candidates.map((candidate, index) => [
        `evidence_${index + 1}`,
        noul(
          {
            task: "Is this evidence candidate materially relevant to deciding whether the supplied rule is violated?",
            candidateId:
              candidate.id ?? `${candidate.path}:${candidate.startLine ?? 1}`,
          },
          {
            true: "The candidate contains facts needed to apply the rule or compare the change with its surrounding contract or convention.",
            false:
              "The candidate is incidental, merely nearby, or does not help decide the rule.",
          },
        ),
      ]),
    ),
    ...(context.modelName === undefined ? {} : { model: context.modelName }),
  };
}

function candidateBatches(
  rule: SemanticLintRule,
  candidates: readonly SemanticLintEvidence[],
  context: RoutingRequestContext,
): readonly (readonly SemanticLintEvidence[])[] {
  if (candidates.length === 0) {
    return [];
  }
  const maximumBytes = context.config.evidence.maximumEvaluationRequestBytes;
  const lengths = Array.from(
    { length: candidates.length },
    (_unused, index) => candidates.length - index,
  );
  const batchLength = lengths.find(
    (length) =>
      requestBytes(
        relevanceRequest(rule, candidates.slice(0, length), context),
      ) <= maximumBytes,
  );
  if (batchLength === undefined) {
    return candidateBatches(rule, candidates.slice(1), context);
  }
  return [
    candidates.slice(0, batchLength),
    ...candidateBatches(rule, candidates.slice(batchLength), context),
  ];
}

type RelevanceBatchResult = Readonly<{
  scores: readonly Readonly<{
    candidate: SemanticLintEvidence;
    probability: number;
  }>[];
  usage: RoutingUsage;
}>;

async function relevanceBatch(
  rule: SemanticLintRule,
  batch: readonly SemanticLintEvidence[],
  context: RoutingRequestContext,
): Promise<Result<RelevanceBatchResult, TypeSafeEvaluationError>> {
  const response = await context.evaluator.evaluate(
    relevanceRequest(rule, batch, context),
    context.requestOptions,
  );
  if (!response.ok) {
    return response;
  }
  const answers = batch.map((candidate, index) => ({
    candidate,
    answer: noulResponse(response.value.answers[`evidence_${index + 1}`]),
  }));
  if (answers.some((item) => item.answer === undefined)) {
    return fail({
      tag: "TypeSafeEvaluationError",
      message: `TypeSafe returned no relevance answer for ${rule.ruleId}`,
    });
  }
  return ok({
    scores: answers.flatMap(({ candidate, answer }) =>
      answer === undefined ? [] : [{ candidate, probability: answer.noul }],
    ),
    usage: usageFromResponse(response.value.model, response.value.usage),
  });
}

async function selectRelevantEvidence(
  rule: SemanticLintRule,
  candidates: readonly SemanticLintEvidence[],
  context: RoutingRequestContext,
): Promise<Result<RelevanceResult, TypeSafeEvaluationError>> {
  const fallbackModel = context.modelName ?? "jev-latest";
  const batchResults = await Promise.all(
    candidateBatches(rule, candidates, context).map((batch) =>
      relevanceBatch(rule, batch, context),
    ),
  );
  const results = collect(batchResults);
  if (!results.ok) {
    return results;
  }
  const ranked = results.value
    .flatMap((result) => result.scores)
    .toSorted((left, right) => right.probability - left.probability);
  const selected = ranked
    .filter(
      (item) =>
        item.probability >= context.config.routing.minimumRelevanceProbability,
    )
    .slice(0, context.config.routing.maximumSelectedEvidence);
  const selectedIds = new Set(selected.map((item) => item.candidate.id));
  return ok({
    evidence: selected.map((item) => ({
      ...item.candidate,
      relevanceProbability: item.probability,
    })),
    decisions: ranked.map((item) => ({
      stage: "relevance",
      candidate: item.candidate.id ?? item.candidate.path,
      probability: item.probability,
      selected: selectedIds.has(item.candidate.id),
    })),
    usage: mergeRoutingUsage(
      results.value.map((result) => result.usage),
      fallbackModel,
    ),
  });
}

function unavailableFinding(
  rule: SemanticLintRule,
  evaluator: Extract<
    SemanticLintRule["metadata"]["evaluator"],
    "semantic" | "review"
  >,
  classification: "not_applicable" | "insufficient_evidence",
  message: string,
  decisions: readonly SemanticLintRoutingDecision[],
): SemanticLintFinding {
  return {
    rulePath: rule.rulePath,
    ruleTitle: rule.ruleTitle,
    evaluator,
    classification,
    message,
    evidence: [],
    routing: { decisions, selectedEvidenceIds: [] },
  };
}

function finalRequest(
  rule: SemanticLintRule,
  evidence: readonly SemanticLintEvidence[],
  context: RoutingRequestContext,
): SemanticLintEvaluationRequest {
  const state: EntryType = {
    candidate: { kind: "routed-rule-evidence", rule: rule.rulePath },
    evidence: evidenceState(evidence),
  };
  return {
    state,
    questions: questionsFromRules([rule], context.config.questionPrompt),
    ...(context.modelName === undefined ? {} : { model: context.modelName }),
  };
}

function fitFinalEvidence(
  rule: SemanticLintRule,
  evidence: readonly SemanticLintEvidence[],
  context: RoutingRequestContext,
): readonly SemanticLintEvidence[] {
  const maximumBytes = context.config.evidence.maximumEvaluationRequestBytes;
  const lengths = Array.from(
    { length: evidence.length },
    (_unused, index) => evidence.length - index,
  );
  const matchingLength = lengths.find(
    (length) =>
      requestBytes(finalRequest(rule, evidence.slice(0, length), context)) <=
      maximumBytes,
  );
  return matchingLength === undefined ? [] : evidence.slice(0, matchingLength);
}

export async function routeAndEvaluateRule(
  rule: SemanticLintRule,
  evidence: SemanticLintRepositoryEvidence,
  relations: RepositoryRelations,
  context: RoutingRequestContext,
): Promise<Result<RoutedRuleResult, TypeSafeEvaluationError>> {
  const fallbackModel = context.modelName ?? "jev-latest";
  const evaluator =
    rule.metadata.evaluator === "review" ? "review" : "semantic";
  const route = await routeRuleHunks(rule, evidence.diffFiles, context);
  if (!route.ok) {
    return route;
  }
  const expanded = expandEvidence(
    rule,
    route.value.selected.map((selected) => selected.value),
    evidence,
    context.config,
    relations,
  );
  const relevance =
    route.value.selected.length === 0
      ? ok({
          evidence: [],
          decisions: [],
          usage: emptyRoutingUsage(fallbackModel),
        })
      : await selectRelevantEvidence(rule, expanded, context);
  if (!relevance.ok) {
    return relevance;
  }
  const selected = fitFinalEvidence(rule, relevance.value.evidence, context);
  const decisions = [...route.value.decisions, ...relevance.value.decisions];
  const preliminaryUsage = mergeRoutingUsage(
    [route.value.usage, relevance.value.usage],
    fallbackModel,
  );
  if (selected.length === 0) {
    const classification =
      rule.metadata.scope === "source"
        ? ("not_applicable" as const)
        : ("insufficient_evidence" as const);
    const message =
      classification === "not_applicable"
        ? "No changed evidence candidate applies to this source-scoped rule."
        : "Layered routing found no sufficiently relevant bounded evidence.";
    return ok({
      findings: [
        unavailableFinding(rule, evaluator, classification, message, decisions),
      ],
      usage: preliminaryUsage,
    });
  }
  const response = await context.evaluator.evaluate(
    finalRequest(rule, selected, context),
    context.requestOptions,
  );
  if (!response.ok) {
    return response;
  }
  const answer = noulResponse(response.value.answers[rule.ruleId]);
  if (answer === undefined) {
    return fail({
      tag: "TypeSafeEvaluationError",
      message: `TypeSafe returned no rule answer for ${rule.ruleId}`,
    });
  }
  const finding = findingFromAnswer(
    rule,
    answer,
    selected,
    context.config.probabilityThresholds.defaultViolationProbabilityThreshold,
    context.config.probabilityThresholds.maximumPassProbability,
  );
  const finalUsage = usageFromResponse(
    response.value.model,
    response.value.usage,
  );
  return ok({
    findings: [
      {
        ...finding,
        evaluator,
        routing: {
          decisions,
          selectedEvidenceIds: selected.flatMap((item) =>
            item.id === undefined ? [] : [item.id],
          ),
        },
      },
    ],
    usage: mergeRoutingUsage([preliminaryUsage, finalUsage], fallbackModel),
  });
}
