import type { Usage } from "@typesafe-ai/sdk";
import type { SemanticLintFinding } from "./findings";
import type { SemanticLintDryRunPlan } from "./routing/route-rules";
import type { SemanticLintOptions } from "./config";

export type SemanticLintFindingReport = Readonly<{
  source: string;
  model: string;
  violationProbabilityThreshold: number;
  findings: readonly SemanticLintFinding[];
  usage?: Usage;
}>;

type SemanticLintJsonDocument =
  | SemanticLintFindingReport
  | SemanticLintDryRunPlan;

export type SemanticLintOutcome = Readonly<{
  processExitCode: number;
  report:
    | Readonly<{ format: "text"; text: string }>
    | Readonly<{
        format: "json";
        documents: readonly SemanticLintJsonDocument[];
      }>;
}>;

type ReportOptions = Pick<SemanticLintOptions, "mode" | "outputFormat">;

const classifications: readonly SemanticLintFinding["classification"][] = [
  "violation",
  "review",
  "pass",
  "not_applicable",
  "insufficient_evidence",
];

function classificationSummary(
  findings: readonly SemanticLintFinding[],
): string {
  return classifications
    .map((classification) => {
      const count = findings.filter(
        (finding) => finding.classification === classification,
      ).length;
      return `${classification}=${count}`;
    })
    .join(" ");
}

function locationLine(item: SemanticLintFinding["evidence"][number]): string {
  const lineRange =
    item.startLine === undefined
      ? ""
      : `:${item.startLine}-${item.endLine ?? item.startLine}`;
  const relevance =
    item.relevanceProbability === undefined
      ? ""
      : ` relevance=${item.relevanceProbability.toFixed(2)}`;
  return `  at ${item.path}${lineRange}${relevance}`;
}

function findingLines(finding: SemanticLintFinding): readonly string[] {
  const probability =
    finding.violationProbability === undefined
      ? ""
      : ` ${finding.violationProbability}`;
  const selectedEvidence = finding.routing?.selectedEvidenceIds ?? [];
  const routingLine =
    selectedEvidence.length === 0
      ? []
      : [`  routed evidence ${selectedEvidence.join(", ")}`];
  return [
    `[${finding.classification}${probability}] ${finding.ruleTitle} (${finding.rulePath})`,
    `  ${finding.message}`,
    ...routingLine,
    ...finding.evidence.map(locationLine),
  ];
}

function humanReport(report: SemanticLintFindingReport): string {
  const header = [
    `Source file: ${report.source}`,
    classificationSummary(report.findings),
  ];
  const actionable = report.findings.filter(
    (finding) =>
      finding.classification !== "pass" &&
      finding.classification !== "not_applicable",
  );
  if (actionable.length === 0) {
    return [...header, "No findings."].join("\n");
  }
  return [...header, ...actionable.flatMap(findingLines)].join("\n");
}

function hasActionableFindings(
  reports: readonly SemanticLintFindingReport[],
): boolean {
  return reports.some((report) =>
    report.findings.some(
      (finding) =>
        finding.classification === "violation" ||
        finding.classification === "review" ||
        finding.classification === "insufficient_evidence",
    ),
  );
}

/** Renders all findings from one repository evaluation into one CLI outcome. */
export function semanticLintOutcome(
  reports: readonly SemanticLintFindingReport[],
  dryRunPlan: SemanticLintDryRunPlan | undefined,
  options: ReportOptions,
): SemanticLintOutcome {
  const isLive = options.mode === "live";
  const processExitCode = isLive && hasActionableFindings(reports) ? 1 : 0;
  if (options.outputFormat === "json" || options.mode === "dry-run") {
    const documents =
      dryRunPlan === undefined ? reports : [...reports, dryRunPlan];
    return {
      processExitCode,
      report: { format: "json", documents },
    };
  }
  return {
    processExitCode,
    report: {
      format: "text",
      text: reports.map(humanReport).join("\n\n"),
    },
  };
}
