import type { TurnsState, Turn } from "@tyrum/operator-app/node";

export function getTurnList(state: TurnsState): Turn[] {
  return Object.values(state.turnsById).toSorted((a, b) => {
    const aTime = Date.parse(a.created_at);
    const bTime = Date.parse(b.created_at);
    const aScore = Number.isFinite(aTime) ? aTime : 0;
    const bScore = Number.isFinite(bTime) ? bTime : 0;
    if (aScore !== bScore) return bScore - aScore;
    return a.turn_id.localeCompare(b.turn_id);
  });
}
