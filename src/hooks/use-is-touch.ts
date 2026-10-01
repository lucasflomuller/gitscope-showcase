"use client";

import { useEffect, useState } from "react";

/**
 * True when the primary input is a coarse pointer (touch). This is independent
 * of viewport width, so an iPad in landscape (wide) still reports touch.
 * SSR-safe: returns `false` until mounted, then tracks the media query live.
 *
 * For pure styling prefer the Tailwind `pointer-coarse:` variant (no flash);
 * use this hook only where a JS value is needed (e.g. a layout dimension).
 */
export function useIsTouch() {
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia("(pointer: coarse)");
    const onChange = () => setIsTouch(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isTouch;
}
