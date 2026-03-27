import { z } from "zod";
import { AgentConversationKey, HookKey, WorkspaceKey, parseTyrumKey } from "./keys.js";
import { ActionPrimitive } from "./planner.js";

export const LifecycleHookEvent = z.string().trim().min(1);
export type LifecycleHookEvent = z.infer<typeof LifecycleHookEvent>;

const HookAutomationConversationKey = AgentConversationKey.refine((value) => {
  const parsed = parseTyrumKey(value);
  return (
    parsed.kind === "agent" &&
    parsed.thread_kind === "channel" &&
    parsed.channel === "automation" &&
    WorkspaceKey.safeParse(parsed.account).success &&
    parsed.id.startsWith("hook-")
  );
}, "hook conversation key must target an automation channel conversation");

export const LifecycleHookDefinition = z
  .object({
    hook_key: HookKey,
    event: LifecycleHookEvent,
    conversation_key: HookAutomationConversationKey,
    steps: z.array(ActionPrimitive).min(1),
  })
  .superRefine((value, ctx) => {
    const parsed = parseTyrumKey(value.conversation_key);
    if (parsed.kind !== "agent" || parsed.thread_kind !== "channel") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["conversation_key"],
        message: "hook conversation key must target an automation channel conversation",
      });
      return;
    }
    const expectedThreadId = `hook-${value.hook_key.slice("hook:".length)}`;
    if (parsed.id !== expectedThreadId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["conversation_key"],
        message: "hook conversation key must match the canonical hook automation conversation",
      });
    }
  })
  .strict();
export type LifecycleHookDefinition = z.infer<typeof LifecycleHookDefinition>;

export const LifecycleHooksConfig = z
  .object({
    v: z.literal(1),
    hooks: z.array(LifecycleHookDefinition).default([]),
  })
  .strict();
export type LifecycleHooksConfig = z.infer<typeof LifecycleHooksConfig>;
