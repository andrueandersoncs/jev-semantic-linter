import type { Question, RequestOptions } from "@typesafe-ai/sdk";
import { Deferred, Effect, Semaphore } from "effect";
import { TypeSafeEvaluationError } from "../errors";
import type {
  SemanticLintEvaluation,
  SemanticLintEvaluationRequest,
  SemanticLintEvaluationResponse,
} from "../evaluator";

type PendingEvaluation = Readonly<{
  request: SemanticLintEvaluationRequest;
  requestOptions: RequestOptions;
  deferred: Deferred.Deferred<
    SemanticLintEvaluationResponse,
    TypeSafeEvaluationError
  >;
}>;

type BatchMember = Readonly<{
  pending: PendingEvaluation;
  answerIds: Readonly<Record<string, string>>;
}>;

type RequestBatch = Readonly<{
  request: SemanticLintEvaluationRequest;
  requestOptions: RequestOptions;
  members: readonly BatchMember[];
}>;

type BatchPlan = Readonly<{
  batches: readonly RequestBatch[];
  oversized: readonly PendingEvaluation[];
}>;

function requestBytes(request: SemanticLintEvaluationRequest): number {
  return Buffer.byteLength(JSON.stringify(request));
}

function groupedBySharedState(
  pending: readonly PendingEvaluation[],
): readonly (readonly PendingEvaluation[])[] {
  const groupsByOptions = new Map<
    RequestOptions,
    Map<string, PendingEvaluation[]>
  >();
  for (const item of pending) {
    const groups = groupsByOptions.get(item.requestOptions) ?? new Map();
    groupsByOptions.set(item.requestOptions, groups);
    const key = JSON.stringify({
      model: item.request.model ?? null,
      state: item.request.state,
    });
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return [...groupsByOptions.values()].flatMap((groups) => [
    ...groups.values(),
  ]);
}

function requestBatch(pending: readonly PendingEvaluation[]): RequestBatch {
  const first = pending[0];
  if (first === undefined) {
    throw new Error("Cannot build an empty TypeSafe request batch");
  }
  if (pending.length === 1) {
    const answerIds = Object.fromEntries(
      Object.keys(first.request.questions).map((answerId) => [
        answerId,
        answerId,
      ]),
    );
    return {
      request: first.request,
      requestOptions: first.requestOptions,
      members: [{ pending: first, answerIds }],
    };
  }
  let nextQuestionOrdinal = 1;
  const questions: Record<string, Question> = {};
  const members = pending.map((item) => {
    const answerIds: Record<string, string> = {};
    for (const [answerId, question] of Object.entries(item.request.questions)) {
      const batchAnswerId = `q${nextQuestionOrdinal}`;
      nextQuestionOrdinal += 1;
      questions[batchAnswerId] = question;
      answerIds[answerId] = batchAnswerId;
    }
    return { pending: item, answerIds };
  });
  return {
    request: {
      state: first.request.state,
      questions,
      ...(first.request.model === undefined
        ? {}
        : { model: first.request.model }),
    },
    requestOptions: first.requestOptions,
    members,
  };
}

function batchPlan(
  group: readonly PendingEvaluation[],
  maximumRequestBytes: number,
): BatchPlan {
  const batches: RequestBatch[] = [];
  const oversized: PendingEvaluation[] = [];
  let current: PendingEvaluation[] = [];
  for (const item of group) {
    const candidate = requestBatch([...current, item]);
    if (requestBytes(candidate.request) <= maximumRequestBytes) {
      current.push(item);
      continue;
    }
    if (current.length > 0) {
      batches.push(requestBatch(current));
    }
    const single = requestBatch([item]);
    if (requestBytes(single.request) > maximumRequestBytes) {
      oversized.push(item);
      current = [];
    } else {
      current = [item];
    }
  }
  if (current.length > 0) {
    batches.push(requestBatch(current));
  }
  return { batches, oversized };
}

function tokenShare(total: number, index: number, count: number): number {
  return Math.floor(total / count) + (index < total % count ? 1 : 0);
}

function responseForMember(
  response: SemanticLintEvaluationResponse,
  member: BatchMember,
  index: number,
  memberCount: number,
): SemanticLintEvaluationResponse {
  const answers = Object.fromEntries(
    Object.entries(member.answerIds).flatMap(([answerId, batchAnswerId]) => {
      const answer = response.answers[batchAnswerId];
      return answer === undefined ? [] : [[answerId, answer]];
    }),
  );
  return {
    model: response.model,
    answers,
    usage: {
      input_tokens: tokenShare(response.usage.input_tokens, index, memberCount),
      output_tokens: tokenShare(
        response.usage.output_tokens,
        index,
        memberCount,
      ),
    },
  };
}

export function batchedSemanticLintEvaluation(
  evaluator: SemanticLintEvaluation,
  maximumRequestBytes: number,
  maximumConcurrentRequests: number,
): SemanticLintEvaluation {
  const semaphore = Semaphore.makeUnsafe(
    Math.max(1, maximumConcurrentRequests),
  );
  let pending: PendingEvaluation[] = [];
  let flushScheduled = false;

  function runBatch(batch: RequestBatch): Effect.Effect<void> {
    return Effect.matchEffect(
      semaphore.withPermit(
        evaluator.evaluate(batch.request, batch.requestOptions),
      ),
      {
        onFailure: (error) =>
          Effect.asVoid(
            Effect.forEach(batch.members, (member) =>
              Deferred.fail(member.pending.deferred, error),
            ),
          ),
        onSuccess: (response) =>
          Effect.asVoid(
            Effect.forEach(batch.members, (member, index) =>
              Deferred.succeed(
                member.pending.deferred,
                responseForMember(
                  response,
                  member,
                  index,
                  batch.members.length,
                ),
              ),
            ),
          ),
      },
    );
  }

  function flush(): Effect.Effect<void> {
    return Effect.gen(function* () {
      yield* Effect.yieldNow;
      const queued = yield* Effect.sync(() => {
        const current = pending;
        pending = [];
        flushScheduled = false;
        return current;
      });
      const plans = groupedBySharedState(queued).map((group) =>
        batchPlan(group, maximumRequestBytes),
      );
      yield* Effect.forEach(
        plans.flatMap((plan) => plan.oversized),
        (item) =>
          Deferred.fail(
            item.deferred,
            new TypeSafeEvaluationError({
              message: `TypeSafe request exceeds ${maximumRequestBytes} bytes.`,
            }),
          ),
        { concurrency: "unbounded" },
      );
      yield* Effect.forEach(
        plans.flatMap((plan) => plan.batches),
        runBatch,
        { concurrency: "unbounded" },
      );
    });
  }

  return {
    evaluate: (request, requestOptions) =>
      Effect.gen(function* () {
        const deferred = yield* Deferred.make<
          SemanticLintEvaluationResponse,
          TypeSafeEvaluationError
        >();
        const shouldSchedule = yield* Effect.sync(() => {
          pending.push({ request, requestOptions, deferred });
          if (flushScheduled) {
            return false;
          }
          flushScheduled = true;
          return true;
        });
        if (shouldSchedule) {
          yield* Effect.forkDetach(flush());
        }
        return yield* Deferred.await(deferred);
      }),
  };
}
