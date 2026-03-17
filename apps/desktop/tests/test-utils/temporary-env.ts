export async function withTemporaryEnvVar<T>(
  key: string,
  value: string,
  run: () => Promise<T>,
): Promise<T> {
  const previousValue = process.env[key];
  process.env[key] = value;

  try {
    return await run();
  } finally {
    if (previousValue === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previousValue;
    }
  }
}
