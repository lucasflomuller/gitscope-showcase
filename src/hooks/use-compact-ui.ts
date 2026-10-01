"use client";

import { useIsMobile } from "./use-is-mobile";
import { useIsTouch } from "./use-is-touch";

/**
 * Use the compact / touch-first layout when the screen is narrow OR the device
 * is touch-driven. This means a tablet in landscape (wide, but touch) still gets
 * the compact chrome instead of the mouse-oriented desktop layout.
 */
export function useCompactUI() {
  const isMobile = useIsMobile();
  const isTouch = useIsTouch();
  return isMobile || isTouch;
}
