import { z } from "zod";

export const ExecutionBackendId = z.enum(["native", "claude_agent_sdk", "codex", "opencode"]);
export type ExecutionBackendId = z.infer<typeof ExecutionBackendId>;

export const DEFAULT_EXECUTION_BACKEND: ExecutionBackendId = "native";
