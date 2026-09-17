import type {
  NoulQuestion,
  SystemOneRequest,
  SystemOneResult,
} from "@typesafe-ai/sdk";

export type Rule = Readonly<{
  id: string;
  path: string;
  title: string;
  text: string;
}>;

export type Options = Readonly<{
  threshold: number;
  model?: string;
  json: boolean;
  dryRun: boolean;
}>;

export type Configuration = Readonly<{
  arguments: Readonly<{
    runtimeStartIndex: number;
    helpFlag: string;
    defaultJson: boolean;
    defaultDryRun: boolean;
  }>;
  thresholds: Readonly<{
    defaultViolation: number;
    passMaximum: number;
    minimumExclusive: number;
    maximum: number;
  }>;
  rules: Readonly<{
    pattern: string;
    firstOrdinal: number;
    idPrefix: string;
    emptyLength: number;
    fileLabel: string;
  }>;
  output: Readonly<{
    jsonIndentSpaces: number;
    unknownLanguage: string;
    sourceFileLabel: string;
    noChangedFiles: string;
  }>;
  question: Readonly<{
    task: string;
    guidance: string;
    violation: string;
    compliance: string;
  }>;
  exitCodes: Readonly<{
    success: number;
    findings: number;
    runtimeError: number;
  }>;
}>;

export type QuestionSet = Readonly<Record<string, NoulQuestion>>;
export type EvaluationRequest = Readonly<SystemOneRequest<QuestionSet>>;
export type EvaluationResponse = Readonly<SystemOneResult<QuestionSet>>;

export type Finding = Readonly<
  Rule & {
    probability: number;
    status: "violation" | "review" | "pass";
  }
>;

export type LintOutcome = Readonly<{
  exitCode: number;
  output: string;
}>;
