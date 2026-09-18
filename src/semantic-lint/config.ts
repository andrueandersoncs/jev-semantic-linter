type ArgumentDefaults = Readonly<{
  runtimeArgumentStartIndex: number;
  helpFlag: string;
  defaultOutputFormat: "text" | "json";
  defaultMode: "live" | "dry-run";
}>;

type ProbabilityThresholds = Readonly<{
  defaultViolationProbabilityThreshold: number;
  maximumPassProbability: number;
  minimumViolationProbabilityExclusive: number;
  maximumViolationProbability: number;
}>;

type RuleFileConfiguration = Readonly<{
  ruleFilePattern: string;
  firstRuleOrdinal: number;
  ruleIdPrefix: string;
}>;

type EvidenceConfiguration = Readonly<{
  sourceFileExtensions: readonly string[];
  repositoryFileExtensions: readonly string[];
  sourceChunkLineCount: number;
  sourceChunkOverlapLineCount: number;
  maximumEvaluationRequestBytes: number;
}>;

export type RoutingConfiguration = Readonly<{
  maximumChoiceOptions: number;
  beamWidth: number;
  maximumConcurrentRequests: number;
  maximumExpandedCandidates: number;
  maximumSelectedEvidence: number;
  minimumRelevanceProbability: number;
  maximumEvidenceSnippetBytes: number;
}>;

type OutputConfiguration = Readonly<{
  jsonIndentSpaces: number;
  unknownLanguageName: string;
  sourceFileLabel: string;
  noChangedFiles: string;
}>;

type QuestionPrompt = Readonly<{
  evaluationTask: string;
  evaluationGuidance: string;
  violationCriterion: string;
  complianceCriterion: string;
}>;

type ProcessExitCodes = Readonly<{
  success: number;
  findingsFound: number;
  runtimeError: number;
}>;

export type SemanticLintOptions = Readonly<{
  violationProbabilityThreshold: number;
  modelName?: string;
  reviewContextPath?: string;
  outputFormat: "text" | "json";
  mode: "live" | "dry-run";
}>;

export type SemanticLintConfiguration = Readonly<{
  argumentDefaults: ArgumentDefaults;
  probabilityThresholds: ProbabilityThresholds;
  ruleFiles: RuleFileConfiguration;
  evidence: EvidenceConfiguration;
  routing: RoutingConfiguration;
  outputFormat: OutputConfiguration;
  questionPrompt: QuestionPrompt;
  processExitCodes: ProcessExitCodes;
}>;
