export function wildcardMatch(pattern: string, input: string): boolean {
  if (pattern === input) return true;

  const p = pattern;
  const s = input;

  let pi = 0;
  let si = 0;
  let starIndex = -1;
  let matchIndex = 0;

  while (si < s.length) {
    const pc = p[pi];
    if (pc === "?" || pc === s[si]) {
      pi += 1;
      si += 1;
      continue;
    }

    if (pc === "*") {
      starIndex = pi;
      matchIndex = si;
      pi += 1;
      continue;
    }

    if (starIndex !== -1) {
      pi = starIndex + 1;
      matchIndex += 1;
      si = matchIndex;
      continue;
    }

    return false;
  }

  while (p[pi] === "*") {
    pi += 1;
  }

  return pi === p.length;
}
