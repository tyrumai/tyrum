export interface SemanticMutationField {
  column: string;
  currentValue: unknown;
  nextValue: unknown;
}

export interface SemanticMutationUpdate {
  assignments: string[];
  values: unknown[];
}

export function buildUpdatedAtMutation(
  fields: readonly SemanticMutationField[],
  updatedAtIso: string,
): SemanticMutationUpdate | undefined {
  const assignments: string[] = [];
  const values: unknown[] = [];

  for (const field of fields) {
    if (Object.is(field.currentValue, field.nextValue)) continue;
    assignments.push(`${field.column} = ?`);
    values.push(field.nextValue);
  }

  if (assignments.length === 0) return undefined;

  assignments.push("updated_at = ?");
  values.push(updatedAtIso);
  return { assignments, values };
}
