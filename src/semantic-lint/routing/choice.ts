import {
  choice,
  type ChoiceResponse,
  type EntryType,
  type Usage,
} from "@typesafe-ai/sdk";
import { basename, extname } from "node:path";
import { Effect } from "effect";
import { TypeSafeEvaluationError } from "../errors";
import { choiceResponse } from "../runtime/typesafe/response";
import type {
  SemanticLintEvaluation,
  SemanticLintEvaluationRequest,
} from "../evaluator";
import type { SemanticLintConfiguration } from "../config";
import type { SemanticLintDiffFile, SemanticLintDiffHunk } from "../evidence";
import { ruleMatchesPath, type SemanticLintRule } from "../rules";
export type SemanticLintRoutingDecision = Readonly<{
  stage: "domain" | "path" | "hunk" | "relevance";
  candidate: string;
  probability: number;
  selected: boolean;
}>;

const evidenceDomains = {
  source: "Changed application or library source code.",
  tests: "Changed tests, fixtures, or test configuration.",
  configuration: "Changed runtime, build, lint, or TypeScript configuration.",
  dependencies: "Changed package manifests or dependency lockfiles.",
  documentation: "Changed documentation or natural-language policy.",
  repository_structure:
    "Changed files whose location or repository role is the evidence.",
} as const;

export type RoutingRequestContext = Readonly<{
  config: SemanticLintConfiguration;
  modelName?: string;
  evaluator: SemanticLintEvaluation;
  requestOptions: Parameters<SemanticLintEvaluation["evaluate"]>[1];
}>;

export type RoutingUsage = Readonly<{
  model: string;
  inputTokens: number;
  outputTokens: number;
}>;

type Scored<T> = Readonly<{
  value: T;
  logProbability: number;
  decisions: number;
}>;

export type RoutedHunk = Readonly<{
  file: SemanticLintDiffFile;
  hunk: SemanticLintDiffHunk;
}>;

type EvidenceDomain = keyof typeof evidenceDomains;
type RouteOption<T> = Readonly<{
  id: string;
  description: string;
  value: T;
}>;
type RouteExecution<T> = Readonly<{
  selected: readonly Scored<T>[];
  decisions: readonly SemanticLintRoutingDecision[];
  usage: RoutingUsage;
}>;

export function emptyRoutingUsage(model: string): RoutingUsage {
  return { model, inputTokens: 0, outputTokens: 0 };
}

export function mergeRoutingUsage(
  usages: readonly RoutingUsage[],
  fallbackModel: string,
): RoutingUsage {
  return usages.reduce<RoutingUsage>(
    (total, usage) => ({
      model: usage.model,
      inputTokens: total.inputTokens + usage.inputTokens,
      outputTokens: total.outputTokens + usage.outputTokens,
    }),
    emptyRoutingUsage(fallbackModel),
  );
}

function routingUsage(model: string, usage: Usage): RoutingUsage {
  return {
    model,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
  };
}

export function truncateBytes(value: string, maximumBytes: number): string {
  const bytes = Buffer.from(value);
  if (bytes.length <= maximumBytes) {
    return value;
  }
  let prefixLength = Math.max(0, Math.floor(maximumBytes));
  while (prefixLength > 0 && ((bytes[prefixLength] ?? 0) & 0xc0) === 0x80) {
    prefixLength -= 1;
  }
  return `${bytes.subarray(0, prefixLength).toString("utf8")}\n[truncated]`;
}

function requestBytes(request: SemanticLintEvaluationRequest): number {
  return Buffer.byteLength(JSON.stringify(request));
}

function probabilityScore(value: Scored<unknown>): number {
  return Math.exp(value.logProbability / value.decisions);
}

function best<T>(
  values: readonly Scored<T>[],
  width: number,
): readonly Scored<T>[] {
  return values
    .toSorted((left, right) => probabilityScore(right) - probabilityScore(left))
    .slice(0, width);
}

function joined<T, U>(parent: Scored<T>, child: Scored<U>): Scored<U> {
  return {
    value: child.value,
    logProbability: parent.logProbability + child.logProbability,
    decisions: parent.decisions + child.decisions,
  };
}

function choiceInstructions(
  rule: SemanticLintRule,
  stage: SemanticLintRoutingDecision["stage"],
): EntryType {
  return {
    task: "Select the evidence candidate most likely to help decide this rule.",
    stage,
    rule: {
      source: rule.rulePath,
      definition: rule.definition,
      scope: rule.metadata.scope,
      requiredEvidence: [...rule.metadata.requiredEvidence],
    },
    guidance:
      "Choose none when every candidate is unrelated. The caller retains several probable alternatives.",
  };
}

function askChoice<T>(
  rule: SemanticLintRule,
  stage: SemanticLintRoutingDecision["stage"],
  options: readonly RouteOption<T>[],
  context: RoutingRequestContext,
): Effect.Effect<
  Readonly<{ answer?: ChoiceResponse; usage: RoutingUsage }>,
  TypeSafeEvaluationError
> {
  const descriptionBytes = Math.max(
    128,
    Math.floor(
      (context.config.evidence.maximumEvaluationRequestBytes -
        Buffer.byteLength(rule.definition) -
        4096) /
        (options.length + 1),
    ),
  );
  const criteria = Object.fromEntries([
    ...options.map(
      (option) =>
        [
          option.id,
          truncateBytes(option.description, descriptionBytes),
        ] as const,
    ),
    ["none", "None of these candidates supplies relevant evidence."],
  ]);
  const state: EntryType = {
    stage,
    candidateIds: options.map((option) => option.id),
  };
  const request: SemanticLintEvaluationRequest = {
    state,
    questions: { route: choice(choiceInstructions(rule, stage), criteria) },
    ...(context.modelName === undefined ? {} : { model: context.modelName }),
  };
  const fallbackModel = context.modelName ?? "jev-latest";
  if (
    requestBytes(request) >
    context.config.evidence.maximumEvaluationRequestBytes
  ) {
    return Effect.succeed({ usage: emptyRoutingUsage(fallbackModel) });
  }
  return Effect.flatMap(
    context.evaluator.evaluate(request, context.requestOptions),
    (response) => {
      const answer = choiceResponse(response.answers.route);
      return answer === undefined
        ? Effect.fail(
            new TypeSafeEvaluationError({
              message: `TypeSafe returned no Choice answer for ${rule.ruleId}`,
            }),
          )
        : Effect.succeed({
            answer,
            usage: routingUsage(response.model, response.usage),
          });
    },
  );
}

function optionBuckets<T>(
  options: readonly RouteOption<T>[],
  size: number,
  depth: number,
): readonly RouteOption<readonly RouteOption<T>[]>[] {
  const bucketCount = Math.ceil(options.length / size);
  return Array.from({ length: bucketCount }, (_unused, index) => {
    const members = options.slice(index * size, (index + 1) * size);
    return {
      id: `bucket_${depth}_${index + 1}`,
      description: members.map((member) => member.description).join("; "),
      value: members,
    };
  });
}

function routeOptions<T>(
  rule: SemanticLintRule,
  stage: SemanticLintRoutingDecision["stage"],
  options: readonly RouteOption<T>[],
  context: RoutingRequestContext,
  depth = 0,
): Effect.Effect<RouteExecution<T>, TypeSafeEvaluationError> {
  return Effect.gen(function* () {
    const fallbackModel = context.modelName ?? "jev-latest";
    if (options.length === 0) {
      return {
        selected: [],
        decisions: [],
        usage: emptyRoutingUsage(fallbackModel),
      };
    }
    const onlyOption = options.length === 1 ? options[0] : undefined;
    if (onlyOption !== undefined) {
      return {
        selected: [
          { value: onlyOption.value, logProbability: 0, decisions: 1 },
        ],
        decisions: [
          {
            stage,
            candidate: onlyOption.id,
            probability: 1,
            selected: true,
          },
        ],
        usage: emptyRoutingUsage(fallbackModel),
      };
    }
    const candidateLimit = context.config.routing.maximumChoiceOptions - 1;
    if (options.length > candidateLimit) {
      const bucketRoute = yield* routeOptions(
        rule,
        stage,
        optionBuckets(options, candidateLimit, depth),
        context,
        depth + 1,
      );
      const memberRoutes = yield* Effect.forEach(
        bucketRoute.selected,
        (selectedBucket) =>
          Effect.map(
            routeOptions(rule, stage, selectedBucket.value, context, depth + 1),
            (memberRoute) => ({
              selected: memberRoute.selected.map((candidate) =>
                joined(selectedBucket, candidate),
              ),
              decisions: memberRoute.decisions,
              usage: memberRoute.usage,
            }),
          ),
        { concurrency: "unbounded" },
      );
      return {
        selected: best(
          memberRoutes.flatMap((route) => route.selected),
          context.config.routing.beamWidth,
        ),
        decisions: [
          ...bucketRoute.decisions,
          ...memberRoutes.flatMap((route) => route.decisions),
        ],
        usage: mergeRoutingUsage(
          [bucketRoute.usage, ...memberRoutes.map((route) => route.usage)],
          fallbackModel,
        ),
      };
    }
    const { answer, usage } = yield* askChoice(rule, stage, options, context);
    if (answer === undefined) {
      return { selected: [], decisions: [], usage };
    }
    const ranked = options
      .map((option) => ({
        option,
        probability: answer.probabilities[option.id] ?? 0,
      }))
      .toSorted((left, right) => right.probability - left.probability);
    const chosen =
      answer.choice === "none"
        ? undefined
        : ranked.find((item) => item.option.id === answer.choice);
    const noneProbability = answer.probabilities.none ?? 0;
    const alternatives = ranked.filter(
      (item) =>
        item.option.id !== answer.choice && item.probability > noneProbability,
    );
    const selectedItems =
      chosen === undefined
        ? []
        : [chosen, ...alternatives].slice(0, context.config.routing.beamWidth);
    const selectedIds = new Set(selectedItems.map((item) => item.option.id));
    const decisions: readonly SemanticLintRoutingDecision[] = [
      ...ranked.map((item) => ({
        stage,
        candidate: item.option.id,
        probability: item.probability,
        selected: selectedIds.has(item.option.id),
      })),
      {
        stage,
        candidate: "none",
        probability: answer.probabilities.none ?? 0,
        selected: answer.choice === "none",
      },
    ];
    return {
      selected: selectedItems.map((item) => ({
        value: item.option.value,
        logProbability: Math.log(Math.max(item.probability, Number.EPSILON)),
        decisions: 1,
      })),
      decisions,
      usage,
    };
  });
}

export function domainForPath(path: string): EvidenceDomain {
  const name = basename(path).toLowerCase();
  if (
    /(^|\/)(__tests__|tests?|fixtures?)(\/|$)/.test(path) ||
    /\.(test|spec)\.[^.]+$/.test(name)
  ) {
    return "tests";
  }
  if (
    name === "package.json" ||
    name.startsWith("bun.lock") ||
    /(?:^|-)lock\.(?:json|yaml|yml)$/.test(name)
  ) {
    return "dependencies";
  }
  if (
    name === "bunfig.toml" ||
    name.startsWith("tsconfig") ||
    name.includes("config") ||
    [".toml", ".yaml", ".yml"].includes(extname(name))
  ) {
    return "configuration";
  }
  if ([".md", ".mdx", ".txt"].includes(extname(name))) {
    return "documentation";
  }
  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(extname(name))) {
    return "source";
  }
  return "repository_structure";
}

function fileDescription(file: SemanticLintDiffFile): string {
  const headers = file.hunks
    .map((hunk) => hunk.header)
    .filter(Boolean)
    .slice(0, 4);
  const detail = headers.length === 0 ? "" : `; ${headers.join("; ")}`;
  return `${file.status} ${file.path}${detail}`;
}

function syntheticHunk(file: SemanticLintDiffFile): SemanticLintDiffHunk {
  return {
    id: `${file.id}_hunk_0`,
    path: file.path,
    oldStartLine: 1,
    oldLineCount: 0,
    newStartLine: 1,
    newLineCount: 0,
    header: `${file.status} file without textual hunks`,
    patch: `${file.status}: ${file.path}`,
  };
}

function eligibleFiles(
  rule: SemanticLintRule,
  diffFiles: readonly SemanticLintDiffFile[],
): readonly SemanticLintDiffFile[] {
  return diffFiles.filter((file) => {
    if (!ruleMatchesPath(rule, file.path)) {
      return false;
    }
    if (rule.metadata.scope !== "source") {
      return true;
    }
    const domain = domainForPath(file.path);
    return domain === "source" || domain === "tests";
  });
}

export function routeRuleHunks(
  rule: SemanticLintRule,
  diffFiles: readonly SemanticLintDiffFile[],
  context: RoutingRequestContext,
): Effect.Effect<RouteExecution<RoutedHunk>, TypeSafeEvaluationError> {
  return Effect.gen(function* () {
    const fallbackModel = context.modelName ?? "jev-latest";
    const filesByDomain = Map.groupBy(eligibleFiles(rule, diffFiles), (file) =>
      domainForPath(file.path),
    );
    const domainOptions = [...filesByDomain.entries()].map(
      ([domain, files]) => ({
        id: `domain_${domain}`,
        description: `${evidenceDomains[domain]} Changed files: ${files.map((file) => file.path).join(", ")}`,
        value: domain,
      }),
    );
    const domainRoute = yield* routeOptions(
      rule,
      "domain",
      domainOptions,
      context,
    );
    const fileRoutes = yield* Effect.forEach(
      domainRoute.selected,
      (selectedDomain) => {
        const options = (filesByDomain.get(selectedDomain.value) ?? []).map(
          (file) => ({
            id: file.id,
            description: fileDescription(file),
            value: file,
          }),
        );
        return Effect.map(
          routeOptions(rule, "path", options, context),
          (fileRoute) => ({
            selected: fileRoute.selected.map((file) =>
              joined(selectedDomain, file),
            ),
            decisions: fileRoute.decisions,
            usage: fileRoute.usage,
          }),
        );
      },
      { concurrency: "unbounded" },
    );
    const selectedFiles = best(
      fileRoutes.flatMap((route) => route.selected),
      context.config.routing.beamWidth,
    );
    const hunkRoutes = yield* Effect.forEach(
      selectedFiles,
      (selectedFile) => {
        const hunks =
          selectedFile.value.hunks.length === 0
            ? [syntheticHunk(selectedFile.value)]
            : selectedFile.value.hunks;
        const options = hunks.map((hunk) => ({
          id: hunk.id,
          description: `${hunk.path}:${hunk.newStartLine} ${hunk.header}\n${truncateBytes(
            hunk.patch,
            Math.floor(context.config.routing.maximumEvidenceSnippetBytes / 3),
          )}`,
          value: { file: selectedFile.value, hunk },
        }));
        return Effect.map(
          routeOptions(rule, "hunk", options, context),
          (hunkRoute) => ({
            selected: hunkRoute.selected.map((hunk) =>
              joined(selectedFile, hunk),
            ),
            decisions: hunkRoute.decisions,
            usage: hunkRoute.usage,
          }),
        );
      },
      { concurrency: "unbounded" },
    );
    const usages = [
      domainRoute.usage,
      ...fileRoutes.map((route) => route.usage),
      ...hunkRoutes.map((route) => route.usage),
    ];
    return {
      selected: best(
        hunkRoutes.flatMap((route) => route.selected),
        context.config.routing.beamWidth,
      ),
      decisions: [
        ...domainRoute.decisions,
        ...fileRoutes.flatMap((route) => route.decisions),
        ...hunkRoutes.flatMap((route) => route.decisions),
      ],
      usage: mergeRoutingUsage(usages, fallbackModel),
    };
  });
}
