export interface WaitForConditionOptions {
  timeoutMs?: number;
  intervalMs?: number;
  description?: string;
  debug?: () => string | Promise<string>;
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.stack ?? err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  opts: WaitForConditionOptions = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const intervalMs = opts.intervalMs ?? 25;
  const description = opts.description ?? "condition";
  const startMs = Date.now();
  const deadlineMs = Date.now() + timeoutMs;

  let attempts = 0;
  let errorCount = 0;
  let lastError: unknown;
  let lastErrorAttempt = 0;

  for (;;) {
    attempts += 1;
    try {
      if (await condition()) return;
    } catch (err) {
      lastError = err;
      errorCount += 1;
      lastErrorAttempt = attempts;
    }

    if (Date.now() >= deadlineMs) {
      const elapsedMs = Date.now() - startMs;
      const messageParts = [
        `[waitForCondition] timed out after ${elapsedMs}ms (limit=${timeoutMs}ms, attempts=${attempts}) waiting for ${description}`,
      ];
      if (lastError) {
        messageParts.push(
          `errors: ${errorCount} (last at attempt ${lastErrorAttempt}): ${formatError(lastError)}`,
        );
      }
      if (opts.debug) {
        try {
          const debugState = await opts.debug();
          if (debugState) messageParts.push(`debug: ${debugState}`);
        } catch (err) {
          messageParts.push(`debug error: ${formatError(err)}`);
        }
      }
      throw new Error(messageParts.join("\n"));
    }

    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
}
