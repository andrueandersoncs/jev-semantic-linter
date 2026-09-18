import type {
  ChoiceResponse,
  NoulResponse,
  ScoreResponse,
} from "@typesafe-ai/sdk";
import type { TypeSafeEvaluationError } from "../../errors";
import type { SemanticLintEvaluationResponse } from "../../evaluator";
import { fail, ok, type Result } from "../../../result";

type Schema<T> = Readonly<{
  accepts(value: unknown): value is T;
}>;

type TypeSafeAnswer = ChoiceResponse | NoulResponse | ScoreResponse;

const recordSchema: Schema<Readonly<Record<string, unknown>>> = {
  accepts: (value): value is Readonly<Record<string, unknown>> =>
    typeof value === "object" && value !== null && !Array.isArray(value),
};

const probabilitySchema: Schema<number> = {
  accepts: (value): value is number =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1,
};

const probabilityRecordSchema: Schema<Readonly<Record<string, number>>> = {
  accepts(value): value is Readonly<Record<string, number>> {
    return (
      recordSchema.accepts(value) &&
      Object.values(value).every(probabilitySchema.accepts)
    );
  },
};

const choiceResponseSchema: Schema<ChoiceResponse> = {
  accepts(value): value is ChoiceResponse {
    return (
      recordSchema.accepts(value) &&
      value.type === "choice" &&
      typeof value.choice === "string" &&
      probabilitySchema.accepts(value.confidence) &&
      probabilityRecordSchema.accepts(value.probabilities)
    );
  },
};

const noulResponseSchema: Schema<NoulResponse> = {
  accepts(value): value is NoulResponse {
    return (
      recordSchema.accepts(value) &&
      value.type === "noul" &&
      probabilitySchema.accepts(value.noul)
    );
  },
};

const scoreResponseSchema: Schema<ScoreResponse> = {
  accepts(value): value is ScoreResponse {
    if (!recordSchema.accepts(value) || !recordSchema.accepts(value.legend)) {
      return false;
    }
    const validLegend = Object.values(value.legend).every(
      (item) => item === null || typeof item === "string",
    );
    return (
      value.type === "score" &&
      typeof value.score === "number" &&
      Number.isFinite(value.score) &&
      probabilitySchema.accepts(value.confidence) &&
      validLegend &&
      probabilityRecordSchema.accepts(value.probabilities)
    );
  },
};

const answerSchema: Schema<TypeSafeAnswer> = {
  accepts: (value): value is TypeSafeAnswer =>
    choiceResponseSchema.accepts(value) ||
    noulResponseSchema.accepts(value) ||
    scoreResponseSchema.accepts(value),
};

const usageSchema: Schema<
  Readonly<{ input_tokens: number; output_tokens: number }>
> = {
  accepts(value): value is Readonly<{
    input_tokens: number;
    output_tokens: number;
  }> {
    if (!recordSchema.accepts(value)) {
      return false;
    }
    return (
      Number.isInteger(value.input_tokens) &&
      Number(value.input_tokens) >= 0 &&
      Number.isInteger(value.output_tokens) &&
      Number(value.output_tokens) >= 0
    );
  },
};

const typeSafeResponseSchema: Schema<SemanticLintEvaluationResponse> = {
  accepts(value): value is SemanticLintEvaluationResponse {
    if (!recordSchema.accepts(value) || !recordSchema.accepts(value.answers)) {
      return false;
    }
    const validAnswers = Object.values(value.answers).every(
      answerSchema.accepts,
    );
    return (
      typeof value.model === "string" &&
      value.model.length > 0 &&
      validAnswers &&
      usageSchema.accepts(value.usage)
    );
  },
};

export function parseTypeSafeResponse(
  value: unknown,
): Result<SemanticLintEvaluationResponse, TypeSafeEvaluationError> {
  if (!typeSafeResponseSchema.accepts(value)) {
    return fail({
      tag: "TypeSafeEvaluationError",
      message: "TypeSafe returned an invalid response.",
    });
  }
  return ok(value);
}

export function choiceResponse(value: unknown): ChoiceResponse | undefined {
  return choiceResponseSchema.accepts(value) ? value : undefined;
}

export function noulResponse(value: unknown): NoulResponse | undefined {
  return noulResponseSchema.accepts(value) ? value : undefined;
}
