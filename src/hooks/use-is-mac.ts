"use client";

import { useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};

/**
 * True on Apple platforms — flips shortcut hints between ⌘ and Ctrl.
 * SSR-safe: renders the Ctrl variant on the server, corrects on hydration.
 */
export function useIsMac(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => /Mac|iPhone|iPad/.test(navigator.platform ?? ""),
    () => false,
  );
}
