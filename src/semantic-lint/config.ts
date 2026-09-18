type ProbabilityThresholds = Readonly<{
  defaultViolationProbabilityThreshold: number;
  maximumPassProbability: number;
  minimumViolationProbabilityExclusive: number;
  maximumViolationProbability: number;
}>;

type EvidenceConfiguration = Readonly<{
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

export type SemanticLintOptions = Readonly<{
  violationProbabilityThreshold: number;
  modelName?: string;
  reviewContextPath?: string;
  outputFormat: "text" | "json";
  mode: "live" | "dry-run";
}>;

export type SemanticLintConfiguration = Readonly<{
  probabilityThresholds: ProbabilityThresholds;
  evidence: EvidenceConfiguration;
  routing: RoutingConfiguration;
}>;

export const semanticLintConfig: SemanticLintConfiguration = {
  probabilityThresholds: {
    defaultViolationProbabilityThreshold: 0.7,
    maximumPassProbability: 0.4,
    minimumViolationProbabilityExclusive: 0.5,
    maximumViolationProbability: 1,
  },
  evidence: {
    repositoryFileExtensions: [
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
      ".json",
      ".toml",
      ".yaml",
      ".yml",
      ".md",
    ],
    sourceChunkLineCount: 80,
    sourceChunkOverlapLineCount: 20,
    maximumEvaluationRequestBytes: 32000,
  },
  routing: {
    maximumChoiceOptions: 16,
    beamWidth: 3,
    maximumConcurrentRequests: 800,
    maximumExpandedCandidates: 12,
    maximumSelectedEvidence: 6,
    minimumRelevanceProbability: 0.45,
    maximumEvidenceSnippetBytes: 6000,
  },
};
