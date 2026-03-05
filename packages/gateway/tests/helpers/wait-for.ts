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
  const deadlineMs = Date.now() + timeoutMs;

  let lastError: unknown;

  for (;;) {
    try {
      if (await condition()) return;
      lastError = undefined;
    } catch (err) {
      lastError = err;
    }

    if (Date.now() >= deadlineMs) {
      const messageParts = [
        `[waitForCondition] timed out after ${timeoutMs}ms waiting for ${description}`,
      ];
      if (lastError) messageParts.push(`last error: ${formatError(lastError)}`);
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
