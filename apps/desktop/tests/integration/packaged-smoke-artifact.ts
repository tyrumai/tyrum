export const TRUST_PACKAGED_SMOKE_ARTIFACT_ENV = "TYRUM_TRUST_PACKAGED_SMOKE_ARTIFACT";

export type PackagedSmokePreparationMode =
  | "restored-ci-artifact"
  | "reused-local-release"
  | "rebuilt-local-release";

export interface PackagedSmokeArtifactPaths {
  packagedSmokeStampPath: string;
  packagedExecutableCandidates: readonly string[];
  currentBuildArtifactPaths: readonly string[];
}

export interface PackagedSmokeArtifactPreparationOptions extends PackagedSmokeArtifactPaths {
  env: NodeJS.ProcessEnv;
  exists: (path: string) => boolean;
  statMtimeMs: (path: string) => number;
  ensureBuildArtifacts: () => void;
  rebuildPackagedRelease: () => void;
  log: (message: string) => void;
}

function hasPackagedExecutable(
  packagedExecutableCandidates: readonly string[],
  exists: (path: string) => boolean,
): boolean {
  return packagedExecutableCandidates.some((candidate) => exists(candidate));
}

function hasCurrentDesktopBuildArtifacts(
  currentBuildArtifactPaths: readonly string[],
  exists: (path: string) => boolean,
): boolean {
  return currentBuildArtifactPaths.every((path) => exists(path));
}

function isPackagedReleaseCurrent({
  packagedSmokeStampPath,
  packagedExecutableCandidates,
  currentBuildArtifactPaths,
  exists,
  statMtimeMs,
}: Pick<
  PackagedSmokeArtifactPreparationOptions,
  | "packagedSmokeStampPath"
  | "packagedExecutableCandidates"
  | "currentBuildArtifactPaths"
  | "exists"
  | "statMtimeMs"
>): boolean {
  if (
    !exists(packagedSmokeStampPath) ||
    !hasPackagedExecutable(packagedExecutableCandidates, exists) ||
    !hasCurrentDesktopBuildArtifacts(currentBuildArtifactPaths, exists)
  ) {
    return false;
  }

  const releaseMtimeMs = statMtimeMs(packagedSmokeStampPath);
  return currentBuildArtifactPaths.every((path) => statMtimeMs(path) <= releaseMtimeMs);
}

function getTrustedArtifactContractError({
  packagedSmokeStampPath,
  packagedExecutableCandidates,
  exists,
}: Pick<
  PackagedSmokeArtifactPreparationOptions,
  "packagedSmokeStampPath" | "packagedExecutableCandidates" | "exists"
>): Error | undefined {
  const missingParts: string[] = [];

  if (!exists(packagedSmokeStampPath)) {
    missingParts.push(`packaged smoke marker at ${packagedSmokeStampPath}`);
  }

  if (!hasPackagedExecutable(packagedExecutableCandidates, exists)) {
    missingParts.push(
      `packaged desktop executable (checked: ${packagedExecutableCandidates.join(", ")})`,
    );
  }

  if (missingParts.length === 0) return undefined;

  return new Error(
    `CI packaged smoke artifact contract broken: missing ${missingParts.join("; ")}`,
  );
}

export function ensurePackagedSmokeArtifact({
  env,
  packagedSmokeStampPath,
  packagedExecutableCandidates,
  currentBuildArtifactPaths,
  exists,
  statMtimeMs,
  ensureBuildArtifacts,
  rebuildPackagedRelease,
  log,
}: PackagedSmokeArtifactPreparationOptions): PackagedSmokePreparationMode {
  if (env[TRUST_PACKAGED_SMOKE_ARTIFACT_ENV] === "1") {
    const contractError = getTrustedArtifactContractError({
      packagedSmokeStampPath,
      packagedExecutableCandidates,
      exists,
    });
    if (contractError) throw contractError;

    log("Using restored packaged smoke artifact from CI build job.");
    return "restored-ci-artifact";
  }

  ensureBuildArtifacts();

  if (
    isPackagedReleaseCurrent({
      packagedSmokeStampPath,
      packagedExecutableCandidates,
      currentBuildArtifactPaths,
      exists,
      statMtimeMs,
    })
  ) {
    return "reused-local-release";
  }

  log("Rebuilding packaged smoke artifact locally.");
  rebuildPackagedRelease();
  return "rebuilt-local-release";
}
