"use client"

import * as React from "react"
import { CircleAlert, Loader2, Plus } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

export function AddRepoDialog({
  onAdd,
}: {
  onAdd: (input: { path: string; name?: string }) => Promise<void>
}) {
  const [open, setOpen] = React.useState(false)
  const [path, setPath] = React.useState("")
  const [name, setName] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setPath("")
      setName("")
      setError(null)
      setPending(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = path.trim()
    if (!trimmed || pending) return
    setPending(true)
    setError(null)
    try {
      await onAdd({ path: trimmed, name: name.trim() || undefined })
      handleOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="pointer-coarse:h-9" />
        }
      >
        <Plus />
        Add repo
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add repository</DialogTitle>
          <DialogDescription>
            Point GitScope at a local git repository to compare its refs.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="add-repo-path"
              className="text-sm font-medium"
            >
              Path
            </label>
            <Input
              id="add-repo-path"
              value={path}
              autoFocus
              placeholder="~/projects/my-repo"
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setPath(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="add-repo-name"
              className="text-sm font-medium"
            >
              Name{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </label>
            <Input
              id="add-repo-name"
              value={name}
              placeholder="defaults to the folder name"
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {error ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>Couldn&apos;t add repository</AlertTitle>
              {/* Errors embed the resolved absolute path — one unbreakable
                  token that would otherwise blow past the dialog's max-width. */}
              <AlertDescription className="wrap-anywhere">
                {error}
              </AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={pending || !path.trim()}>
              {pending ? (
                <>
                  <Loader2 className="animate-spin" />
                  Adding…
                </>
              ) : (
                "Add repo"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
