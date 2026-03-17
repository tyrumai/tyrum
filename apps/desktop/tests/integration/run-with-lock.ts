export async function runWithLock<T>(
  acquireLock: () => () => void,
  action: () => Promise<T>,
): Promise<T> {
  const releaseLock = acquireLock();
  try {
    return await action();
  } finally {
    releaseLock();
  }
}
