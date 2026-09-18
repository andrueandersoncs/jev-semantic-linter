import { noul, type EntryType, type Usage } from "@typesafe-ai/sdk";
import { Effect } from "effect";
import { noulResponse } from "../runtime/typesafe/response";
import { TypeSafeEvaluationError } from "../errors";
import { findingFromAnswer, type SemanticLintFinding } from "../findings";
import type { SemanticLintEvaluationRequest } from "../evaluator";
import { questionsFromRules } from "../rules";
import type {
  SemanticLintEvidence,
  SemanticLintRepositoryEvidence,
} from "../evidence";
import type { SemanticLintRule } from "../rules";
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
  return candidates
    .toSorted(
      (left, right) =>
        (left.id ?? "").localeCompare(right.id ?? "") ||
        left.path.localeCompare(right.path) ||
        (left.startLine ?? 0) - (right.startLine ?? 0) ||
        (left.endLine ?? 0) - (right.endLine ?? 0) ||
        (left.kind ?? "").localeCompare(right.kind ?? "") ||
        (left.relation ?? "").localeCompare(right.relation ?? "") ||
        (left.snippet ?? "").localeCompare(right.snippet ?? ""),
    )
    .map((candidate) => ({
      id: candidate.id ?? null,
      kind: candidate.kind ?? null,
      relation: candidate.relation ?? null,
      path: candidate.path,
      startLine: candidate.startLine ?? null,
      endLine: candidate.endLine ?? null,
      snippet: candidate.snippet ?? null,
    }));
}

function relevanceRequest(
  rule: SemanticLintRule,
  candidates: readonly SemanticLintEvidence[],
  context: RoutingRequestContext,
): SemanticLintEvaluationRequest {
  const state: EntryType = {
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
            rule: {
              source: rule.rulePath,
              definition: rule.definition,
              scope: rule.metadata.scope,
              requiredEvidence: [...rule.metadata.requiredEvidence],
            },
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

function relevanceBatch(
  rule: SemanticLintRule,
  batch: readonly SemanticLintEvidence[],
  context: RoutingRequestContext,
): Effect.Effect<RelevanceBatchResult, TypeSafeEvaluationError> {
  return Effect.flatMap(
    context.evaluator.evaluate(
      relevanceRequest(rule, batch, context),
      context.requestOptions,
    ),
    (response) => {
      const answers = batch.map((candidate, index) => ({
        candidate,
        answer: noulResponse(response.answers[`evidence_${index + 1}`]),
      }));
      return answers.some((item) => item.answer === undefined)
        ? Effect.fail(
            new TypeSafeEvaluationError({
              message: `TypeSafe returned no relevance answer for ${rule.ruleId}`,
            }),
          )
        : Effect.succeed({
            scores: answers.flatMap(({ candidate, answer }) =>
              answer === undefined
                ? []
                : [{ candidate, probability: answer.noul }],
            ),
            usage: usageFromResponse(response.model, response.usage),
          });
    },
  );
}

function selectRelevantEvidence(
  rule: SemanticLintRule,
  candidates: readonly SemanticLintEvidence[],
  context: RoutingRequestContext,
): Effect.Effect<RelevanceResult, TypeSafeEvaluationError> {
  const fallbackModel = context.modelName ?? "jev-latest";
  return Effect.map(
    Effect.forEach(
      candidateBatches(rule, candidates, context),
      (batch) => relevanceBatch(rule, batch, context),
      { concurrency: "unbounded" },
    ),
    (results) => {
      const ranked = results
        .flatMap((result) => result.scores)
        .toSorted((left, right) => right.probability - left.probability);
      const selected = ranked
        .filter(
          (item) =>
            item.probability >=
            context.config.routing.minimumRelevanceProbability,
        )
        .slice(0, context.config.routing.maximumSelectedEvidence);
      const selectedIds = new Set(selected.map((item) => item.candidate.id));
      return {
        evidence: selected.map((item) => ({
          ...item.candidate,
          relevanceProbability: item.probability,
        })),
        decisions: ranked.map((item) => ({
          stage: "relevance" as const,
          candidate: item.candidate.id ?? item.candidate.path,
          probability: item.probability,
          selected: selectedIds.has(item.candidate.id),
        })),
        usage: mergeRoutingUsage(
          results.map((result) => result.usage),
          fallbackModel,
        ),
      };
    },
  );
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
    evidence: evidenceState(evidence),
  };
  return {
    state,
    questions: questionsFromRules([rule]),
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

export function routeAndEvaluateRule(
  rule: SemanticLintRule,
  evidence: SemanticLintRepositoryEvidence,
  relations: RepositoryRelations,
  context: RoutingRequestContext,
): Effect.Effect<RoutedRuleResult, TypeSafeEvaluationError> {
  return Effect.gen(function* () {
    const fallbackModel = context.modelName ?? "jev-latest";
    const evaluator =
      rule.metadata.evaluator === "review" ? "review" : "semantic";
    const route = yield* routeRuleHunks(rule, evidence.diffFiles, context);
    const expanded = expandEvidence(
      rule,
      route.selected.map((selected) => selected.value),
      evidence,
      context.config,
      relations,
    );
    const relevance =
      route.selected.length === 0
        ? {
            evidence: [],
            decisions: [],
            usage: emptyRoutingUsage(fallbackModel),
          }
        : yield* selectRelevantEvidence(rule, expanded, context);
    const selected = fitFinalEvidence(rule, relevance.evidence, context);
    const decisions = [...route.decisions, ...relevance.decisions];
    const preliminaryUsage = mergeRoutingUsage(
      [route.usage, relevance.usage],
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
      return {
        findings: [
          unavailableFinding(
            rule,
            evaluator,
            classification,
            message,
            decisions,
          ),
        ],
        usage: preliminaryUsage,
      };
    }
    const response = yield* context.evaluator.evaluate(
      finalRequest(rule, selected, context),
      context.requestOptions,
    );
    const answer = noulResponse(response.answers[rule.ruleId]);
    if (answer === undefined) {
      return yield* Effect.fail(
        new TypeSafeEvaluationError({
          message: `TypeSafe returned no rule answer for ${rule.ruleId}`,
        }),
      );
    }
    const finding = findingFromAnswer(
      rule,
      answer,
      selected,
      context.config.probabilityThresholds.defaultViolationProbabilityThreshold,
      context.config.probabilityThresholds.maximumPassProbability,
    );
    const finalUsage = usageFromResponse(response.model, response.usage);
    return {
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
    };
  });
}
