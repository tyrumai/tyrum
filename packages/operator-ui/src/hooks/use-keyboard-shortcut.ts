import { useEffect, useRef } from "react";

export type KeyboardShortcut = {
  key: string;
  handler: (event: KeyboardEvent) => void;
  requireCmdOrCtrl?: boolean;
  preventDefault?: boolean;
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tagName = target.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
}

export function useKeyboardShortcut(shortcuts: ReadonlyArray<KeyboardShortcut>): void {
  const shortcutsRef = useRef(shortcuts);

  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (isTypingTarget(event.target)) return;

      const currentShortcuts = shortcutsRef.current;
      for (const shortcut of currentShortcuts) {
        if (event.key !== shortcut.key) continue;
        if (shortcut.requireCmdOrCtrl && !(event.metaKey || event.ctrlKey)) continue;
        if (shortcut.preventDefault !== false) {
          event.preventDefault();
        }
        shortcut.handler(event);
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}
