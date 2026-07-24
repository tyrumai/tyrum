/**
 * The narrow slice of `@anthropic-ai/claude-agent-sdk` this adapter depends on.
 *
 * Declaring it locally keeps the vendor SDK out of the gateway's type surface,
 * lets the conformance suite drive the adapter without an API key, and — with
 * the lazy loader below — keeps the SDK (and the native binary it bundles) off
 * the startup path entirely while the backend flag is off.
 */

/** Result of the SDK's `canUseTool` permission callback. */
export type ClaudePermissionResult =
  | { behavior: "allow"; updatedInput: Record<string, unknown> }
  | { behavior: "deny"; message: string };

export type ClaudeCanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: { signal?: AbortSignal },
) => Promise<ClaudePermissionResult>;

export interface ClaudeHookInput {
  readonly hook_event_name: string;
  readonly tool_name?: string;
  readonly tool_input?: unknown;
  readonly tool_response?: unknown;
  readonly session_id?: string;
  /** `PostToolUseFailure` only: why the tool call failed. */
  readonly error?: string;
  /** `PostToolUseFailure` only: the failure was a user interrupt. */
  readonly is_interrupt?: boolean;
}

export type ClaudeHookCallback = (
  input: ClaudeHookInput,
  toolUseId: string | undefined,
  context: { signal?: AbortSignal },
) => Promise<Record<string, unknown>>;

/** Messages the SDK's async iterator yields, narrowed to what we translate. */
export interface ClaudeSdkMessage {
  readonly type: string;
  readonly subtype?: string;
  readonly session_id?: string;
  readonly result?: string;
  readonly message?: {
    readonly content?: ReadonlyArray<{
      readonly type: string;
      readonly text?: string;
      readonly id?: string;
      readonly name?: string;
      readonly input?: Record<string, unknown>;
      readonly tool_use_id?: string;
      readonly content?: unknown;
      readonly is_error?: boolean;
    }>;
  };
}

/**
 * Subset of the SDK's `SandboxSettings` this adapter sets.
 *
 * Both flags are pinned to `false` and both are load-bearing:
 *
 * - `autoAllowBashIfSandboxed` would auto-approve Bash whenever the sandbox is
 *   active, and auto-approved tools never reach `canUseTool`. That would put
 *   shell execution outside Tyrum's approval router.
 * - `allowUnsandboxedCommands` defaults to **true** in the SDK
 *   (`sdk.d.ts`: "Allow commands to run outside the sandbox via the
 *   dangerouslyDisableSandbox parameter … Default: true"), and
 *   `dangerouslyDisableSandbox` is a model-settable `Bash` input. Tyrum's match
 *   target is the command string alone, so the sandboxed and unsandboxed
 *   variants of one command are indistinguishable to an operator approving it —
 *   and to any override minted from that approval.
 */
export interface ClaudeSandboxSettings {
  readonly enabled: boolean;
  readonly autoAllowBashIfSandboxed: false;
  readonly allowUnsandboxedCommands: false;
}

/**
 * `allowedTools` is deliberately absent.
 *
 * A tool named there never reaches `canUseTool`, which is the only place Tyrum
 * sees a call's arguments — so it could neither apply workspace confinement nor
 * evaluate policy for that call. Nothing this backend can prove about a tool
 * *name* bounds the *arguments* it will be invoked with, so no auto-allow list
 * is projected and every call goes through the approval router.
 */
export interface ClaudeQueryInput {
  readonly prompt: string;
  readonly options: {
    readonly cwd: string;
    readonly resume?: string;
    readonly canUseTool: ClaudeCanUseTool;
    readonly hooks: Record<string, ReadonlyArray<{ hooks: readonly ClaudeHookCallback[] }>>;
    readonly systemPrompt: {
      readonly type: "preset";
      readonly preset: "claude_code";
      readonly append: string;
    };
    readonly permissionMode: "default";
    readonly settingSources: readonly string[];
    readonly sandbox?: ClaudeSandboxSettings;
    readonly abortController?: AbortController;
  };
}

/** Injectable seam over the SDK's `query()`. */
export type ClaudeQuery = (input: ClaudeQueryInput) => AsyncIterable<ClaudeSdkMessage>;

/**
 * Loads the real SDK on first use.
 *
 * The import is deliberately lazy and dynamic: the gateway must not pay for the
 * SDK — or the platform binary it ships — unless a conversation has actually
 * opted into this backend, which is what "flag off => zero impact" requires.
 */
export async function loadClaudeQuery(): Promise<ClaudeQuery> {
  const moduleName = "@anthropic-ai/claude-agent-sdk";
  const sdk = (await import(moduleName)) as {
    query: (input: unknown) => AsyncIterable<ClaudeSdkMessage>;
  };
  return (input) => sdk.query(input);
}
