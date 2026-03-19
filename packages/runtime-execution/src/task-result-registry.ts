export type TaskResult = {
  ok: boolean;
  result?: unknown;
  evidence?: unknown;
  error?: string;
};

export class TaskResultRegistry {
  private readonly pending = new Map<
    string,
    {
      promise: Promise<TaskResult>;
      resolve: (result: TaskResult) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
      connectionId?: string;
    }
  >();
  private readonly buffered = new Map<string, TaskResult>();
  private readonly preWaitErrors = new Map<string, Error>();
  private readonly terminal = new Map<string, true>();
  private readonly tasksByConnection = new Map<string, Set<string>>();
  private readonly connectionByTask = new Map<string, string>();

  private readonly defaultTimeoutMs: number;
  private readonly maxBuffered: number;
  private readonly maxTerminal: number;
  private readonly maxAssociations: number;

  constructor(opts?: {
    defaultTimeoutMs?: number;
    maxBufferedResults?: number;
    maxTerminalTasks?: number;
    maxTaskAssociations?: number;
  }) {
    this.defaultTimeoutMs = Math.max(1, Math.floor(opts?.defaultTimeoutMs ?? 30_000));
    this.maxBuffered = Math.max(1, Math.floor(opts?.maxBufferedResults ?? 10_000));
    this.maxTerminal = Math.max(1, Math.floor(opts?.maxTerminalTasks ?? 50_000));
    this.maxAssociations = Math.max(1, Math.floor(opts?.maxTaskAssociations ?? this.maxTerminal));
  }

  getAssociatedConnectionId(taskId: string): string | undefined {
    const normalizedTaskId = taskId.trim();
    if (normalizedTaskId.length === 0) return undefined;
    return this.connectionByTask.get(normalizedTaskId);
  }

  associate(taskId: string, connectionId: string): void {
    const normalizedTaskId = taskId.trim();
    const normalizedConnectionId = connectionId.trim();
    if (normalizedTaskId.length === 0) return;
    if (normalizedConnectionId.length === 0) return;
    if (this.terminal.has(normalizedTaskId)) return;

    const pending = this.pending.get(normalizedTaskId);
    this.setAssociation(normalizedTaskId, normalizedConnectionId);
    if (pending && !pending.connectionId) {
      pending.connectionId = normalizedConnectionId;
    }
  }

  wait(taskId: string, opts?: { timeoutMs?: number; connectionId?: string }): Promise<TaskResult> {
    const normalizedTaskId = taskId.trim();
    if (normalizedTaskId.length === 0) {
      return Promise.reject(new Error("taskId is required"));
    }

    const preWaitError = this.preWaitErrors.get(normalizedTaskId);
    if (preWaitError) {
      this.preWaitErrors.delete(normalizedTaskId);
      this.clearAssociation(normalizedTaskId);
      this.markTerminal(normalizedTaskId);
      return Promise.reject(preWaitError);
    }

    if (this.terminal.has(normalizedTaskId)) {
      return Promise.reject(new Error(`task result no longer available: ${normalizedTaskId}`));
    }

    const buffered = this.buffered.get(normalizedTaskId);
    if (buffered) {
      this.buffered.delete(normalizedTaskId);
      this.preWaitErrors.delete(normalizedTaskId);
      this.clearAssociation(normalizedTaskId);
      this.markTerminal(normalizedTaskId);
      return Promise.resolve(buffered);
    }

    const existing = this.pending.get(normalizedTaskId);
    if (existing) {
      return existing.promise;
    }

    const timeoutMs = Math.max(1, Math.floor(opts?.timeoutMs ?? this.defaultTimeoutMs));
    let resolvePromise!: (result: TaskResult) => void;
    let rejectPromise!: (error: Error) => void;
    const promise = new Promise<TaskResult>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    const timer = setTimeout(() => {
      const entry = this.pending.get(normalizedTaskId);
      if (!entry) return;

      this.pending.delete(normalizedTaskId);
      this.clearAssociation(normalizedTaskId, entry.connectionId);
      this.markTerminal(normalizedTaskId);
      entry.reject(new Error(`task result timeout: ${normalizedTaskId}`));
    }, timeoutMs);

    const explicitConnectionId = opts?.connectionId?.trim();
    const associatedConnectionId = this.connectionByTask.get(normalizedTaskId);
    const connectionId = explicitConnectionId || associatedConnectionId;
    const entry = {
      promise,
      resolve: resolvePromise,
      reject: rejectPromise,
      timer,
      connectionId: connectionId && connectionId.length > 0 ? connectionId : undefined,
    };
    this.pending.set(normalizedTaskId, entry);

    if (entry.connectionId) {
      this.setAssociation(normalizedTaskId, entry.connectionId);
    }

    return promise;
  }

  resolve(taskId: string, result: TaskResult): boolean {
    const normalizedTaskId = taskId.trim();
    if (normalizedTaskId.length === 0) return false;

    if (this.terminal.has(normalizedTaskId)) return false;

    const pending = this.pending.get(normalizedTaskId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(normalizedTaskId);
      this.preWaitErrors.delete(normalizedTaskId);
      this.clearAssociation(normalizedTaskId, pending.connectionId);
      this.markTerminal(normalizedTaskId);
      pending.resolve(result);
      return true;
    }

    if (this.buffered.has(normalizedTaskId)) {
      return false;
    }

    this.buffered.set(normalizedTaskId, result);
    this.preWaitErrors.delete(normalizedTaskId);
    this.clearAssociation(normalizedTaskId);
    this.evictOldest(this.buffered, this.maxBuffered);
    return true;
  }

  rejectAllForConnection(connectionId: string): number {
    const normalizedConnectionId = connectionId.trim();
    if (normalizedConnectionId.length === 0) return 0;

    const tasks = this.tasksByConnection.get(normalizedConnectionId);
    if (!tasks || tasks.size === 0) return 0;

    this.tasksByConnection.delete(normalizedConnectionId);

    const taskIds = [...tasks];
    let rejected = 0;
    for (const taskId of taskIds) {
      const entry = this.pending.get(taskId);
      if (entry) {
        clearTimeout(entry.timer);
        this.pending.delete(taskId);
        this.preWaitErrors.delete(taskId);
        this.clearAssociation(taskId, entry.connectionId);
        this.markTerminal(taskId);
        rejected += 1;
        entry.reject(new Error(`task connection disconnected: ${normalizedConnectionId}`));
        continue;
      }

      if (this.buffered.has(taskId)) {
        this.clearAssociation(taskId);
        continue;
      }

      this.preWaitErrors.delete(taskId);
      this.preWaitErrors.set(
        taskId,
        new Error(`task connection disconnected: ${normalizedConnectionId}`),
      );
      this.evictOldest(this.preWaitErrors, this.maxTerminal);
      this.clearAssociation(taskId);
      this.markTerminal(taskId);
    }

    return rejected;
  }

  private markTerminal(taskId: string): void {
    this.terminal.delete(taskId);
    this.terminal.set(taskId, true);
    this.evictOldest(this.terminal, this.maxTerminal);
  }

  private evictOldest<T>(map: Map<string, T>, maxEntries: number): void {
    while (map.size > maxEntries) {
      const oldest = map.keys().next().value as string | undefined;
      if (!oldest) break;
      map.delete(oldest);
    }
  }

  private clearAssociation(taskId: string, fallbackConnectionId?: string): void {
    const connectionId = this.connectionByTask.get(taskId) ?? fallbackConnectionId;
    this.connectionByTask.delete(taskId);
    if (connectionId) {
      this.removeTaskFromConnectionIndex(taskId, connectionId);
    }
  }

  private setAssociation(taskId: string, connectionId: string): void {
    const prev = this.connectionByTask.get(taskId);
    if (prev && prev !== connectionId) {
      this.removeTaskFromConnectionIndex(taskId, prev);
    }

    this.connectionByTask.delete(taskId);
    this.connectionByTask.set(taskId, connectionId);

    let tasks = this.tasksByConnection.get(connectionId);
    if (!tasks) {
      tasks = new Set<string>();
      this.tasksByConnection.set(connectionId, tasks);
    }
    tasks.add(taskId);

    while (this.connectionByTask.size > this.maxAssociations) {
      const oldestTaskId = this.connectionByTask.keys().next().value as string | undefined;
      if (!oldestTaskId) break;
      const oldestConnectionId = this.connectionByTask.get(oldestTaskId);
      this.connectionByTask.delete(oldestTaskId);
      this.preWaitErrors.delete(oldestTaskId);
      if (oldestConnectionId) {
        this.removeTaskFromConnectionIndex(oldestTaskId, oldestConnectionId);
      }
    }
  }

  private removeTaskFromConnectionIndex(taskId: string, connectionId: string): void {
    const tasks = this.tasksByConnection.get(connectionId);
    if (!tasks) return;
    tasks.delete(taskId);
    if (tasks.size === 0) {
      this.tasksByConnection.delete(connectionId);
    }
  }
}
