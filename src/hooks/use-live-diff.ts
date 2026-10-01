"use client";

import { useEffect, useRef, useState } from "react";

/** Client-side floor between `onChange` calls (leading + trailing throttle). */
const THROTTLE_MS = 800;

/**
 * Live working-tree refresh over Server-Sent Events. When `active` and a
 * `repoId` are set, opens an `EventSource` to `/api/repos/[id]/watch` and calls
 * `onChange` (throttled) each time the server reports a `changed` event; the
 * server already debounces filesystem noise, this is a second guard against
 * bursts. `live` reflects whether the stream is currently connected.
 *
 * `onChange` is read through a ref so a new callback identity each render never
 * tears down and reconnects the stream. The stream is left to EventSource's
 * built-in auto-reconnect on transient errors; an explicit `unavailable`
 * message (the server couldn't watch) closes it so we don't reconnect-loop.
 */
export function useLiveDiff(
  repoId: string | null,
  active: boolean,
  onChange: () => void,
): { live: boolean } {
  const [live, setLive] = useState(false);

  // Latest onChange, kept out of the connection effect's deps.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Throttle bookkeeping, persisted across renders.
  const lastFiredRef = useRef(0);
  const trailingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!active || !repoId) return;

    const es = new EventSource(`/api/repos/${repoId}/watch`);

    const fire = () => {
      lastFiredRef.current = Date.now();
      onChangeRef.current();
    };

    // At most one call per THROTTLE_MS: run immediately when the window is
    // open, otherwise schedule a single trailing call for when it reopens.
    const fireThrottled = () => {
      const elapsed = Date.now() - lastFiredRef.current;
      if (elapsed >= THROTTLE_MS) {
        fire();
      } else if (!trailingRef.current) {
        trailingRef.current = setTimeout(() => {
          trailingRef.current = null;
          fire();
        }, THROTTLE_MS - elapsed);
      }
    };

    es.onopen = () => setLive(true);
    es.onmessage = (e) => {
      let msg: { type?: string } | null = null;
      try {
        msg = JSON.parse(e.data) as { type?: string };
      } catch {
        return; // ignore malformed frames
      }
      if (msg?.type === "changed") {
        fireThrottled();
      } else if (msg?.type === "unavailable") {
        // The server can't watch this repo; stop reconnecting.
        es.close();
        setLive(false);
      }
    };
    // Transient error: EventSource auto-reconnects; just reflect not-live.
    es.onerror = () => setLive(false);

    return () => {
      es.close();
      if (trailingRef.current) {
        clearTimeout(trailingRef.current);
        trailingRef.current = null;
      }
      setLive(false);
    };
  }, [repoId, active]);

  return { live };
}
