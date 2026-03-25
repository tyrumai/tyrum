import { z } from "zod";
import { HookKey, TyrumKey } from "./keys.js";
import { ActionPrimitive } from "./planner.js";

export const LifecycleHookEvent = z.string().trim().min(1);
export type LifecycleHookEvent = z.infer<typeof LifecycleHookEvent>;

export const LifecycleHookDefinition = z
  .object({
    hook_key: HookKey,
    event: LifecycleHookEvent,
    conversation_key: TyrumKey.optional(),
    steps: z.array(ActionPrimitive).min(1),
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
