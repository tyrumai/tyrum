import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof globalThis.matchMedia !== "function") return false;
    return globalThis.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof globalThis.matchMedia !== "function") return;

    const mediaQueryList = globalThis.matchMedia(query);
    setMatches(mediaQueryList.matches);

    const handler = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };

    if (typeof mediaQueryList.addEventListener === "function") {
      mediaQueryList.addEventListener("change", handler);
      return () => {
        mediaQueryList.removeEventListener("change", handler);
      };
    }

    // Legacy Safari (<14) support.
    const legacy = mediaQueryList as unknown as {
      addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
      removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
    };

    legacy.addListener?.(handler);
    return () => {
      legacy.removeListener?.(handler);
    };
  }, [query]);

  return matches;
}

