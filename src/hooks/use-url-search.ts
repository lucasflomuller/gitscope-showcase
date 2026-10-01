"use client";

import { useSyncExternalStore } from "react";

// NOT useSearchParams: page.tsx is a root client component with no Suspense
// boundary, and a statically-rendered page calling useSearchParams fails the
// production build. useSyncExternalStore over location.search sidesteps that.
const EMPTY = "";

function subscribe(cb: () => void) {
  // Our own pushState/replaceState calls don't emit popstate — deliberately,
  // so URL writes never feed back into this store.
  window.addEventListener("popstate", cb);
  return () => window.removeEventListener("popstate", cb);
}

function getSnapshot() {
  return window.location.search;
}

function getServerSnapshot() {
  // SSR + first hydration see no params (no mismatch); React swaps to the
  // real client snapshot immediately after hydration.
  return EMPTY;
}

/** The current location.search ("" or "?…"), reactive to back/forward. */
export function useUrlSearch(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
