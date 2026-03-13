import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CONTAINER_NAME_PREFIX = "tyrum-desktop-env";
const DEFAULT_DOCKER_TIMEOUT_MS = 30_000;
const DEFAULT_DOCKER_MAX_BUFFER_BYTES = 16 * 1024 * 1024;

type DockerExecFileError = Error & {
  code?: number | string | null;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
};

export type DockerResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: string;
};

export type DockerInspectContainer = {
  Config?: { Image?: string };
  State?: { Status?: string };
  NetworkSettings?: {
    Ports?: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null>;
  };
};

function normalizeExecOutput(value: string | Buffer | undefined): string {
  if (typeof value === "string") return value;
  return Buffer.isBuffer(value) ? value.toString("utf8") : "";
}

function isMissingContainerResult(result: DockerResult): boolean {
  return /no such (container|object)/iu.test(
    [result.error, result.stderr, result.stdout].filter(Boolean).join("\n"),
  );
}

export async function runDocker(
  args: string[],
  options?: { timeoutMs?: number; maxBufferBytes?: number },
): Promise<DockerResult> {
  try {
    const { stdout, stderr } = await execFileAsync("docker", args, {
      encoding: "utf8",
      timeout: options?.timeoutMs ?? DEFAULT_DOCKER_TIMEOUT_MS,
      maxBuffer: options?.maxBufferBytes ?? DEFAULT_DOCKER_MAX_BUFFER_BYTES,
    });
    return {
      status: 0,
      stdout,
      stderr,
    };
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    const execError = error as DockerExecFileError;
    return {
      status: typeof execError.code === "number" ? execError.code : null,
      stdout: normalizeExecOutput(execError.stdout),
      stderr: normalizeExecOutput(execError.stderr),
      error: execError.message,
    };
  }
}

export async function probeDockerAvailability(): Promise<{ ok: boolean; error?: string }> {
  const result = await runDocker(["info"], { timeoutMs: 15_000 });
  if (result.status === 0) return { ok: true };
  const message = [result.error, result.stderr, result.stdout]
    .filter((entry) => typeof entry === "string" && entry.trim().length > 0)
    .join("\n")
    .trim();
  return { ok: false, error: message || "docker unavailable" };
}

export function containerNameForEnvironment(environmentId: string): string {
  const normalized = environmentId.replace(/[^a-zA-Z0-9_.-]+/g, "-").slice(0, 40);
  return `${CONTAINER_NAME_PREFIX}-${normalized}`;
}

function splitLogLines(raw: string): string[] {
  return raw
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(-200);
}

export function combineDockerError(hint: string, result: DockerResult): string {
  return [hint, result.error, result.stderr, result.stdout]
    .filter((entry) => typeof entry === "string" && entry.trim().length > 0)
    .join("\n")
    .trim();
}

function readPublishedPort(
  inspect: DockerInspectContainer,
  containerPort: "6080/tcp" | "5900/tcp",
): number | null {
  const portBinding = inspect.NetworkSettings?.Ports?.[containerPort];
  const hostPort = Array.isArray(portBinding) ? portBinding[0]?.HostPort : undefined;
  if (!hostPort) return null;
  const parsed = Number.parseInt(hostPort, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function readTakeoverUrl(inspect: DockerInspectContainer): string | null {
  const port = readPublishedPort(inspect, "6080/tcp");
  if (!port) return null;
  return `http://127.0.0.1:${String(port)}/vnc.html?autoconnect=true`;
}

export async function inspectContainer(
  containerName: string,
): Promise<DockerInspectContainer | null> {
  const result = await runDocker(["inspect", containerName]);
  if (result.status !== 0) return null;
  const parsed = JSON.parse(result.stdout) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const first = parsed[0];
  if (!first || typeof first !== "object") return null;
  return first as DockerInspectContainer;
}

export async function readContainerLogs(containerName: string): Promise<string[]> {
  const result = await runDocker(["logs", "--tail", "200", containerName], {
    timeoutMs: 15_000,
    maxBufferBytes: 8 * 1024 * 1024,
  });
  return splitLogLines(`${result.stdout}${result.stderr}`);
}

export async function removeContainer(containerName: string): Promise<void> {
  const result = await runDocker(["rm", "-f", containerName], { timeoutMs: 15_000 });
  if (result.status === 0 || isMissingContainerResult(result)) return;
  throw new Error(combineDockerError("failed to remove desktop environment container", result));
}

export async function removeEnvironmentContainer(environmentId: string): Promise<void> {
  await removeContainer(containerNameForEnvironment(environmentId));
}
