"use client";

import { useEffect, useRef, useState } from "react";

type Listener = (value: unknown) => void;

// Module-level registry so every hook instance sharing a key sees writes
// immediately — e.g. the command palette toggling a pref that the diff viewer
// owns. Keyed by storage key; each entry is the set of live setters.
const listeners = new Map<string, Set<Listener>>();

function subscribe(key: string, fn: Listener): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(fn);
  return () => {
    set.delete(fn);
    if (set.size === 0) listeners.delete(key);
  };
}

/**
 * Persisted state backed by localStorage. SSR-safe: renders `initialValue` on
 * the server and first client paint, then hydrates from storage in an effect
 * (so there is no hydration mismatch). Writes back on every change.
 *
 * Instances sharing a key stay in sync (in this tab via a subscriber registry,
 * across tabs via the `storage` event). Sync passes the value by reference, so
 * React's Object.is bail-out stops the echo after one hop.
 */
export function useLocalStorage<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(initialValue);
  const [hydrated, setHydrated] = useState(false);
  const self = useRef<Listener | null>(null);

  // Reset on a key change (render-phase, no effect). A dynamic key — e.g. the
  // per-repo `gitscope.checkpoints.${repoId}` key — can swap under a persistent
  // hook instance (DiffViewer isn't remounted on repo change). Without this,
  // `value` keeps the previous key's data: the write-back effect below then
  // persists it under the new key whenever that key has no stored data yet,
  // leaking a stale checkpoint (phantom "new since checkpoint" marks). Snap
  // back to the default and mark unhydrated so the write-back stays blocked
  // until the hydrate effect reloads the new key.
  const [curKey, setCurKey] = useState(key);
  if (curKey !== key) {
    setCurKey(key);
    setValue(initialValue);
    setHydrated(false);
  }

  // Browser storage is external state unavailable during SSR. This intentional
  // post-mount hydration must finish before the write-back effect is enabled.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      // ignore unavailable/corrupt storage
    }
    setHydrated(true);

    const listener: Listener = (v) => setValue(v as T);
    self.current = listener;
    const unsubscribe = subscribe(key, listener);

    function onStorage(e: StorageEvent) {
      if (e.key !== key || e.newValue === null) return;
      try {
        setValue(JSON.parse(e.newValue) as T);
      } catch {
        // ignore corrupt payloads from other tabs
      }
    }
    window.addEventListener("storage", onStorage);
    return () => {
      unsubscribe();
      window.removeEventListener("storage", onStorage);
    };
  }, [key]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore quota/unavailable storage
    }
    for (const fn of listeners.get(key) ?? []) {
      if (fn !== self.current) fn(value);
    }
  }, [key, value, hydrated]);

  return [value, setValue] as const;
}
