import type { TyrumUIMessage } from "@tyrum/contracts";

export function messagesEqualIgnoringId(left: TyrumUIMessage, right: TyrumUIMessage): boolean {
  return left.role === right.role && JSON.stringify(left.parts) === JSON.stringify(right.parts);
}

export function appendWithoutDuplicateOverlap(
  existing: readonly TyrumUIMessage[],
  appended: readonly TyrumUIMessage[],
): TyrumUIMessage[] {
  const maxOverlap = Math.min(existing.length, appended.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    let matches = true;
    for (let index = 0; index < overlap; index += 1) {
      const left = existing[existing.length - overlap + index];
      const right = appended[index];
      if (!left || !right || !messagesEqualIgnoringId(left, right)) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return [...existing, ...appended.slice(overlap)];
    }
  }
  return [...existing, ...appended];
}
