/**
 * Policy check route — thin wrapper around evaluatePolicy.
 */

import { Hono } from "hono";
import { PolicyCheckRequest } from "@tyrum/contracts";
import { evaluatePolicy } from "@tyrum/runtime-policy";

const policy = new Hono();

policy.post("/policy/check", async (c) => {
  const body: unknown = await c.req.json();
  const parsed = PolicyCheckRequest.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
  }

  const decision = evaluatePolicy(parsed.data);
  return c.json(decision);
});

export { policy };
