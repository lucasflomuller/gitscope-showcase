"use client"

import * as React from "react"

import { useIsMac } from "@/hooks/use-is-mac"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border bg-muted px-1.5 font-mono text-[11px] font-medium text-muted-foreground">
      {children}
    </kbd>
  )
}

function Row({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <span className="text-sm">{label}</span>
      <span className="flex shrink-0 items-center gap-1">
        {keys.map((k) => (
          <Kbd key={k}>{k}</Kbd>
        ))}
      </span>
    </div>
  )
}

/** The "?" overlay listing every keyboard shortcut in one place. */
export function ShortcutsHelp({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const mod = useIsMac() ? "⌘" : "Ctrl"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription className="sr-only">
            Every keyboard shortcut available in GitScope.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col divide-y">
          <div className="pb-2">
            <p className="pb-1 text-xs font-medium text-muted-foreground">Global</p>
            <Row keys={[mod, "K"]} label="Command palette" />
            <Row keys={[mod, "B"]} label="Toggle sidebar" />
            <Row keys={["R"]} label="Refresh" />
            <Row keys={["?"]} label="This help" />
          </div>
          <div className="pt-2">
            <p className="pb-1 text-xs font-medium text-muted-foreground">Diff</p>
            <Row keys={["/"]} label="Search this diff" />
            <Row keys={["J"]} label="Next file" />
            <Row keys={["K"]} label="Previous file" />
            <Row keys={["V"]} label="Mark viewed · next unviewed" />
            <Row keys={["N"]} label="Next hunk" />
            <Row keys={["P"]} label="Previous hunk" />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
