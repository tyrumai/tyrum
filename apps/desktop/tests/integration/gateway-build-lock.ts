import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

type GatewayBuildLockContents = {
  pid?: number;
};

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isLivePid(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = error && typeof error === "object" ? (error as { code?: string }).code : undefined;
    return code !== "ESRCH";
  }
}

function readGatewayBuildLockContents(lockPath: string): GatewayBuildLockContents | undefined {
  try {
    const raw = readFileSync(lockPath, "utf8").trim();
    if (raw.length === 0) return undefined;
    const parsed = JSON.parse(raw) as GatewayBuildLockContents;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function tryClearStaleGatewayBuildLock(lockPath: string, timeoutMs: number): boolean {
  const metadata = readGatewayBuildLockContents(lockPath);
  const lockAgeMs = Date.now() - statSync(lockPath).mtimeMs;
  const pid = metadata?.pid;
  const isStale = (typeof pid === "number" && !isLivePid(pid)) || lockAgeMs > timeoutMs;
  if (!isStale) return false;
  try {
    unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

export function acquireGatewayBuildLock(lockPath: string, timeoutMs: number): () => void {
  const startedAt = Date.now();
  for (;;) {
    try {
      const fd = openSync(lockPath, "wx");
      writeFileSync(fd, JSON.stringify({ pid: process.pid, created_at_ms: Date.now() }), "utf8");
      return () => {
        try {
          closeSync(fd);
        } catch {
          // ignore
        }
        try {
          unlinkSync(lockPath);
        } catch {
          // ignore
        }
      };
    } catch (error) {
      const code =
        error && typeof error === "object" ? (error as { code?: string }).code : undefined;
      if (code !== "EEXIST") throw error;
      if (existsSync(lockPath) && tryClearStaleGatewayBuildLock(lockPath, timeoutMs)) {
        continue;
      }
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`Timed out waiting for gateway build lock (${timeoutMs}ms): ${lockPath}`);
      }
      sleepSync(200);
    }
  }
}
