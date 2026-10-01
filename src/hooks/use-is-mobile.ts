"use client";

import { useEffect, useState } from "react";

/** Below this width we switch to the touch/drawer layout (< Tailwind `lg`). */
export const MOBILE_BREAKPOINT = 1024;

/**
 * True when the viewport is narrower than `breakpoint`. SSR-safe: returns
 * `false` until mounted, then tracks the media query live.
 */
export function useIsMobile(breakpoint: number = MOBILE_BREAKPOINT) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [breakpoint]);

  return isMobile;
}
