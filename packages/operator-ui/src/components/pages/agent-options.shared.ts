export type AgentOptionSource = {
  agent_key?: string;
  persona?: {
    name?: string;
  };
};

export function normalizeAgentOptions<TInput extends AgentOptionSource, TOutput>(
  input: readonly TInput[],
  toOption: (input: { source: TInput; agentKey: string; personaName: string }) => TOutput | null,
  options?: {
    sort?: (left: TOutput, right: TOutput) => number;
  },
): TOutput[] {
  const byKey = new Map<
    string,
    {
      source: TInput;
      agentKey: string;
      personaName: string;
    }
  >();

  for (const agent of input) {
    const agentKey = agent.agent_key?.trim() ?? "";
    if (!agentKey || byKey.has(agentKey)) {
      continue;
    }
    const personaName = agent.persona?.name?.trim() ?? "";
    byKey.set(agentKey, {
      source: agent,
      agentKey,
      personaName,
    });
  }

  const output = [...byKey.values()].map(({ source, agentKey, personaName }) =>
    toOption({ source, agentKey, personaName }),
  );
  const filtered = output.filter((option): option is TOutput => option !== null);
  if (options?.sort) {
    filtered.sort(options.sort);
  }
  return filtered;
}
