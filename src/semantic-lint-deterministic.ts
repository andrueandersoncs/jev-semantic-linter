import { basename, dirname, extname, join, posix } from "node:path";
import {
  codeExtensions,
  importSpecifiers,
  resolvedRelativeImport,
} from "./semantic-lint-imports";
import type {
  SemanticLintEvidence,
  SemanticLintRepositoryEvidence,
} from "./semantic-lint-evidence";
import type { SemanticLintFinding } from "./semantic-lint-findings";
import type { SemanticLintRule } from "./semantic-lint-rules";

type PackageJson = Readonly<{
  name?: string;
  packageManager?: string;
  scripts?: Readonly<Record<string, string>>;
  dependencies?: Readonly<Record<string, string>>;
  devDependencies?: Readonly<Record<string, string>>;
  peerDependencies?: Readonly<Record<string, string>>;
  optionalDependencies?: Readonly<Record<string, string>>;
  exports?: unknown;
  workspaces?: unknown;
}>;

type PackageManifest = Readonly<{
  path: string;
  root: string;
  value: PackageJson;
}>;

type CheckResult = Readonly<{
  classification: SemanticLintFinding["classification"];
  message: string;
  evidence: readonly SemanticLintEvidence[];
}>;

function evidenceForPaths(
  paths: readonly string[],
): readonly SemanticLintEvidence[] {
  return paths.toSorted().map((path) => ({ path }));
}

function manifestFiles(
  evidence: SemanticLintRepositoryEvidence,
): readonly PackageManifest[] {
  return evidence.files.flatMap((file) => {
    if (basename(file.path) !== "package.json") {
      return [];
    }
    try {
      return [
        {
          path: file.path,
          root: dirname(file.path) === "." ? "" : dirname(file.path),
          value: JSON.parse(file.source) as PackageJson,
        },
      ];
    } catch {
      return [];
    }
  });
}

function externalPackageName(specifier: string): string | undefined {
  if (
    specifier === "bun" ||
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("node:") ||
    specifier.startsWith("bun:")
  ) {
    return undefined;
  }
  const segments = specifier.split("/");
  return specifier.startsWith("@")
    ? segments.slice(0, 2).join("/")
    : segments[0];
}

function owningManifest(
  path: string,
  manifests: readonly PackageManifest[],
): PackageManifest | undefined {
  return manifests
    .filter((manifest) =>
      manifest.root.length === 0 ? true : path.startsWith(`${manifest.root}/`),
    )
    .toSorted((left, right) => right.root.length - left.root.length)[0];
}

function distinctFilenames(
  evidence: SemanticLintRepositoryEvidence,
): CheckResult {
  const namedPaths = evidence.paths
    .map((path) => ({ path, filename: basename(path) }))
    .toSorted((left, right) => left.filename.localeCompare(right.filename));
  const duplicatePaths = namedPaths
    .filter((item, index, all) => {
      const previous = all[index - 1];
      const next = all[index + 1];
      return (
        previous?.filename === item.filename || next?.filename === item.filename
      );
    })
    .map((item) => item.path);
  return duplicatePaths.length === 0
    ? {
        classification: "pass",
        message: "Repository filenames are distinct.",
        evidence: [],
      }
    : {
        classification: "violation",
        message: "The repository contains duplicate filenames.",
        evidence: evidenceForPaths(duplicatePaths),
      };
}

function bunInstallLinker(
  evidence: SemanticLintRepositoryEvidence,
): CheckResult {
  const bunfig = evidence.files.find((file) => file.path === "bunfig.toml");
  if (!bunfig) {
    return {
      classification: "violation",
      message: "bunfig.toml does not set an install linker.",
      evidence: [{ path: "bunfig.toml" }],
    };
  }
  const usesIsolatedLinker = /\blinker\s*=\s*["']isolated["']/.test(
    bunfig.source,
  );
  return usesIsolatedLinker
    ? {
        classification: "pass",
        message: "Bun uses the isolated install linker.",
        evidence: [],
      }
    : {
        classification: "violation",
        message:
          "bunfig.toml must explicitly use the isolated linker or document an exception.",
        evidence: [{ path: bunfig.path }],
      };
}

function undeclaredDependenciesForFile(
  file: SemanticLintRepositoryEvidence["files"][number],
  manifests: readonly PackageManifest[],
): readonly string[] {
  if (!codeExtensions[extname(file.path)]) {
    return [];
  }
  const manifest = owningManifest(file.path, manifests);
  if (!manifest) {
    return [];
  }
  const declared = {
    ...manifest.value.dependencies,
    ...manifest.value.devDependencies,
    ...manifest.value.peerDependencies,
    ...manifest.value.optionalDependencies,
  };
  return importSpecifiers(file).flatMap((specifier) => {
    const packageName = externalPackageName(specifier);
    return packageName && !declared[packageName]
      ? [`${file.path}: ${packageName}`]
      : [];
  });
}

function declaredWorkspaceDependencies(
  evidence: SemanticLintRepositoryEvidence,
): CheckResult {
  const manifests = manifestFiles(evidence);
  const undeclared = evidence.files.flatMap((file) =>
    undeclaredDependenciesForFile(file, manifests),
  );
  return undeclared.length === 0
    ? {
        classification: "pass",
        message: "Every external import is declared by its owning package.",
        evidence: [],
      }
    : {
        classification: "violation",
        message: `Undeclared package imports: ${undeclared.join(", ")}`,
        evidence: evidenceForPaths(
          undeclared.map((entry) => entry.slice(0, entry.indexOf(":"))),
        ),
      };
}

function pinnedBunToolchain(
  evidence: SemanticLintRepositoryEvidence,
): CheckResult {
  const rootManifest = manifestFiles(evidence).find(
    (manifest) => manifest.path === "package.json",
  );
  const lockfiles = evidence.paths.filter((path) =>
    [
      "bun.lock",
      "bun.lockb",
      "package-lock.json",
      "pnpm-lock.yaml",
      "yarn.lock",
    ].includes(basename(path)),
  );
  const competingLockfiles = lockfiles.filter(
    (path) => basename(path) !== "bun.lock",
  );
  const pinnedBun = /^bun@\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(
    rootManifest?.value.packageManager ?? "",
  );
  const workflows = evidence.files.filter((file) =>
    file.path.startsWith(".github/workflows/"),
  );
  const frozenInstall = workflows.some((file) =>
    /bun\s+install\s+[^\n]*--frozen-lockfile/.test(file.source),
  );
  const problems = [
    ...(lockfiles.includes("bun.lock") ? [] : ["missing root bun.lock"]),
    ...(competingLockfiles.length === 0
      ? []
      : [`competing lockfiles: ${competingLockfiles.join(", ")}`]),
    ...(pinnedBun ? [] : ["packageManager does not pin an exact Bun version"]),
    ...(workflows.length === 0 || frozenInstall
      ? []
      : ["CI does not use bun install --frozen-lockfile"]),
  ];
  return problems.length === 0
    ? {
        classification: "pass",
        message: "The repository has one pinned Bun toolchain and lockfile.",
        evidence: [],
      }
    : {
        classification: "violation",
        message: problems.join("; "),
        evidence: evidenceForPaths([
          "package.json",
          ...lockfiles,
          ...workflows.map((file) => file.path),
        ]),
      };
}

function rootScripts(
  evidence: SemanticLintRepositoryEvidence,
): Readonly<Record<string, string>> {
  return (
    manifestFiles(evidence).find((manifest) => manifest.path === "package.json")
      ?.value.scripts ?? {}
  );
}

function rootCheckCommand(
  evidence: SemanticLintRepositoryEvidence,
): CheckResult {
  const scripts = rootScripts(evidence);
  const checkCommand = scripts.check;
  if (!checkCommand) {
    return {
      classification: "violation",
      message: "The root package does not define a check script.",
      evidence: [{ path: "package.json" }],
    };
  }
  const scriptText = [
    checkCommand,
    ...Object.entries(scripts)
      .filter(([name]) => checkCommand.includes(name))
      .map(([, command]) => command),
  ]
    .join(" ")
    .toLowerCase();
  const missing = [
    ["format", /format|prettier|biome/],
    ["lint", /lint|eslint|biome/],
    ["type checking", /typecheck|tsc|tsgo/],
    ["tests", /\btest\b|vitest/],
    ["architecture checks", /architecture|dependency|cycle/],
  ].flatMap(([label, pattern]) =>
    (pattern as RegExp).test(scriptText) ? [] : [label as string],
  );
  return missing.length === 0
    ? {
        classification: "pass",
        message: "The root check command covers the required checks.",
        evidence: [],
      }
    : {
        classification: "violation",
        message: `The root check command omits ${missing.join(", ")}.`,
        evidence: [{ path: "package.json" }],
      };
}

function testAndTypecheckCommands(
  evidence: SemanticLintRepositoryEvidence,
): CheckResult {
  const scripts = rootScripts(evidence);
  const missing = [
    ...(scripts.test ? [] : ["an explicit test command"]),
    ...(scripts.typecheck && /tsc|tsgo/.test(scripts.typecheck)
      ? []
      : ["an independent TypeScript command"]),
  ];
  return missing.length === 0
    ? {
        classification: "pass",
        message: "Test runner and type checking commands are explicit.",
        evidence: [],
      }
    : {
        classification: "violation",
        message: `The root package lacks ${missing.join(" and ")}.`,
        evidence: [{ path: "package.json" }],
      };
}

function bypassesWorkspaceBoundary(
  file: SemanticLintRepositoryEvidence["files"][number],
  manifests: readonly PackageManifest[],
): boolean {
  const sourceManifest = owningManifest(file.path, manifests);
  if (!sourceManifest || !codeExtensions[extname(file.path)]) {
    return false;
  }
  return importSpecifiers(file).some((specifier) => {
    if (specifier.includes("/src/")) {
      return true;
    }
    if (!specifier.startsWith(".")) {
      return false;
    }
    const targetPath = posix.normalize(join(dirname(file.path), specifier));
    const targetManifest = owningManifest(targetPath, manifests);
    return (
      targetManifest !== undefined &&
      targetManifest.path !== sourceManifest.path
    );
  });
}

function workspacePublicImports(
  evidence: SemanticLintRepositoryEvidence,
): CheckResult {
  const manifests = manifestFiles(evidence);
  if (manifests.length <= 1) {
    return {
      classification: "not_applicable",
      message: "The repository has no cross-workspace imports.",
      evidence: [],
    };
  }
  const missingExports = manifests
    .filter((manifest) => manifest.path !== "package.json")
    .filter((manifest) => manifest.value.exports === undefined)
    .map((manifest) => manifest.path);
  const invalidImports = evidence.files
    .filter((file) => bypassesWorkspaceBoundary(file, manifests))
    .map((file) => file.path);
  const uniqueViolations = [...new Set([...missingExports, ...invalidImports])];
  return uniqueViolations.length === 0
    ? {
        classification: "pass",
        message: "Workspace imports use declared public exports.",
        evidence: [],
      }
    : {
        classification: "violation",
        message:
          "Workspace exports or imports bypass a public package boundary.",
        evidence: evidenceForPaths(uniqueViolations),
      };
}

function reachesPath(
  current: string,
  target: string,
  edges: ReadonlyMap<string, readonly string[]>,
  visited: ReadonlySet<string>,
): boolean {
  if (current === target) {
    return true;
  }
  if (visited.has(current)) {
    return false;
  }
  const nextVisited = new Set([...visited, current]);
  const dependencies = edges.get(current) ?? [];
  return dependencies.some((dependency) =>
    reachesPath(dependency, target, edges, nextVisited),
  );
}

function pathBelongsToCycle(
  path: string,
  edges: ReadonlyMap<string, readonly string[]>,
): boolean {
  const dependencies = edges.get(path) ?? [];
  return dependencies.some((dependency) =>
    reachesPath(dependency, path, edges, new Set([path])),
  );
}

function sourceDependencies(
  file: SemanticLintRepositoryEvidence["files"][number],
  sourcePaths: ReadonlySet<string>,
): readonly string[] {
  const relativeSpecifiers = importSpecifiers(file).filter((specifier) =>
    specifier.startsWith("."),
  );
  return relativeSpecifiers.flatMap((specifier) => {
    const target = resolvedRelativeImport(file.path, specifier, sourcePaths);
    return target === undefined ? [] : [target];
  });
}

function dependencyCycles(
  evidence: SemanticLintRepositoryEvidence,
): CheckResult {
  const sources = evidence.files.filter(
    (file) => codeExtensions[extname(file.path)],
  );
  const sourcePaths = new Set(sources.map((file) => file.path));
  const edgeEntries = sources.map(
    (file) => [file.path, sourceDependencies(file, sourcePaths)] as const,
  );
  const edges = new Map(edgeEntries);
  const cyclePaths = [...sourcePaths].filter((path) =>
    pathBelongsToCycle(path, edges),
  );
  return cyclePaths.length === 0
    ? {
        classification: "pass",
        message: "The source dependency graph is acyclic.",
        evidence: [],
      }
    : {
        classification: "violation",
        message: "The source dependency graph contains a cycle.",
        evidence: evidenceForPaths(cyclePaths),
      };
}

function strictRuntimeTsconfig(
  evidence: SemanticLintRepositoryEvidence,
): CheckResult {
  const configs = evidence.files.filter((file) =>
    /^tsconfig(?:\.[^.]+)?\.json$/.test(basename(file.path)),
  );
  if (configs.length === 0) {
    return {
      classification: "not_applicable",
      message: "The repository has no TypeScript configuration.",
      evidence: [],
    };
  }
  const invalid = configs.filter((file) => {
    try {
      const parsed = JSON.parse(file.source.replace(/^\s*\/\/.*$/gm, "")) as {
        compilerOptions?: Record<string, unknown>;
      };
      return (
        parsed.compilerOptions?.strict !== true ||
        parsed.compilerOptions?.noUncheckedIndexedAccess !== true
      );
    } catch {
      return true;
    }
  });
  return invalid.length === 0
    ? {
        classification: "pass",
        message: "TypeScript configurations enable strict checking.",
        evidence: [],
      }
    : {
        classification: "violation",
        message:
          "TypeScript configurations must enable strict and noUncheckedIndexedAccess.",
        evidence: evidenceForPaths(invalid.map((file) => file.path)),
      };
}

function resultForCheck(
  check: string,
  evidence: SemanticLintRepositoryEvidence,
): CheckResult {
  switch (check) {
    case "distinct-filenames":
      return distinctFilenames(evidence);
    case "bun-install-linker":
      return bunInstallLinker(evidence);
    case "declared-workspace-dependencies":
      return declaredWorkspaceDependencies(evidence);
    case "pinned-bun-toolchain":
      return pinnedBunToolchain(evidence);
    case "root-check-command":
      return rootCheckCommand(evidence);
    case "test-and-typecheck-commands":
      return testAndTypecheckCommands(evidence);
    case "workspace-public-imports":
      return workspacePublicImports(evidence);
    case "acyclic-dependencies":
      return dependencyCycles(evidence);
    case "strict-runtime-tsconfig":
      return strictRuntimeTsconfig(evidence);
    default:
      return {
        classification: "insufficient_evidence",
        message: `No deterministic implementation exists for ${check}.`,
        evidence: [],
      };
  }
}

export function deterministicFindings(
  rules: readonly SemanticLintRule[],
  evidence: SemanticLintRepositoryEvidence,
): readonly SemanticLintFinding[] {
  return rules.map((rule) => {
    const check = rule.metadata.deterministicCheck;
    const result = check
      ? resultForCheck(check, evidence)
      : {
          classification: "insufficient_evidence" as const,
          message: "The rule has no deterministic check identifier.",
          evidence: [],
        };
    return {
      rulePath: rule.rulePath,
      ruleTitle: rule.ruleTitle,
      evaluator: "deterministic" as const,
      ...result,
    };
  });
}
