"use client";

import { Keyboard, Moon, MoreHorizontal, RefreshCw, Search, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Compact-layout overflow for the top bar: the global actions (go-to palette,
 * refresh, theme, shortcuts) live behind one button so the bar keeps room for
 * the comparison itself — and the diff toolbar's search is the only magnifier
 * on screen. Desktop keeps them as individual icon buttons.
 */
export function AppMenu({
  onOpenPalette,
  onRefresh,
  refreshing,
  onShowShortcuts,
}: {
  onOpenPalette: () => void;
  onRefresh: () => void;
  refreshing?: boolean;
  onShowShortcuts: () => void;
}) {
  const { setTheme, resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 pointer-coarse:size-10"
            aria-label="More actions"
          />
        }
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuItem className="pointer-coarse:py-2.5" onClick={onOpenPalette}>
          <Search />
          Go to repo, file, ref…
        </DropdownMenuItem>
        <DropdownMenuItem className="pointer-coarse:py-2.5" onClick={onRefresh}>
          <RefreshCw className={refreshing ? "animate-spin" : undefined} />
          Refresh
          <DropdownMenuShortcut className="pointer-coarse:hidden">R</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="pointer-coarse:py-2.5"
          onClick={() => setTheme(dark ? "light" : "dark")}
        >
          {dark ? <Sun /> : <Moon />}
          {dark ? "Light theme" : "Dark theme"}
        </DropdownMenuItem>
        {/* Shortcuts only mean something with a keyboard attached. */}
        <DropdownMenuSeparator className="pointer-coarse:hidden" />
        <DropdownMenuItem className="pointer-coarse:hidden" onClick={onShowShortcuts}>
          <Keyboard />
          Keyboard shortcuts
          <DropdownMenuShortcut>?</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
