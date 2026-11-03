import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { BookOpen, RotateCcw } from 'lucide-react'

import { CopyField } from '#/components/copy-field'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'
import { Button } from '#/components/ui/button'
import { Label } from '#/components/ui/label'
import { Switch } from '#/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { useAction } from '#/hooks/use-action'
import {
  deleteProgress,
  getSyncSettings,
  setKosyncEnabled,
} from '#/lib/sync-functions'
import { cn } from '#/lib/utils'

// KOReader progress sync (/kosync): the server switch for admins, and every
// user's own synced positions, which they can reset.
export const Route = createFileRoute('/_app/settings/sync')({
  loader: () => getSyncSettings(),
  head: () => ({ meta: [{ title: 'KOReader sync · Bookserve' }] }),
  component: Sync,
})

type Progress = Awaited<ReturnType<typeof getSyncSettings>>['progress'][number]

function Sync() {
  const { enabled, url, progress } = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const { error, pending, run } = useAction()
  const [resetting, setResetting] = useState<Progress | null>(null)

  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">KOReader sync</h2>
        <div className="flex items-center gap-2">
          <Label htmlFor="kosync-enabled">Enabled</Label>
          <Switch
            id="kosync-enabled"
            checked={enabled}
            disabled={pending || user.role !== 'admin'}
            onCheckedChange={(next) =>
              run(() => setKosyncEnabled({ data: next }))
            }
          />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className={cn('grid gap-4', !enabled && 'opacity-50')}>
        <dl className="grid gap-4 rounded-lg border p-4 text-sm sm:grid-cols-[8rem_1fr] sm:items-center">
          <dt className="text-muted-foreground">
            <label htmlFor="kosync-url">Server URL</label>
          </dt>
          <dd>
            <CopyField id="kosync-url" value={url} />
          </dd>
          <dt className="text-muted-foreground">Sign in with</dt>
          <dd>
            Bookserve username and an{' '}
            <Link to="/settings/api-keys" className="underline">
              API key
            </Link>
          </dd>
        </dl>
        {progress.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-muted-foreground">
            <BookOpen className="size-8" />
            <p className="text-sm">No synced books</p>
          </div>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Book</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Device</TableHead>
                  <TableHead>Last synced</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {progress.map((row) => (
                  <TableRow key={row.document}>
                    <TableCell className="max-w-64 truncate pl-4 font-medium">
                      {row.book ? (
                        <Link
                          to="/books/$bookId"
                          params={{ bookId: row.book.id }}
                          className="hover:underline"
                        >
                          {row.book.title}
                        </Link>
                      ) : (
                        <span
                          className="font-normal text-muted-foreground"
                          title={row.document}
                        >
                          Not in library
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{Math.round(row.percentage * 100)}%</TableCell>
                    <TableCell>{row.device}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.updatedAt.slice(0, 10)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Reset ${row.book?.title ?? 'progress'}`}
                        onClick={() => setResetting(row)}
                      >
                        <RotateCcw />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
      <ResetDialog progress={resetting} onClose={() => setResetting(null)} />
    </section>
  )
}

function ResetDialog({
  progress,
  onClose,
}: {
  progress: Progress | null
  onClose: () => void
}) {
  const { error, setError, pending, run } = useAction()

  async function onConfirm(event: React.MouseEvent) {
    // Keep the dialog open until the request finishes so errors show inline.
    event.preventDefault()
    if (!progress) return
    const ok = await run(() =>
      deleteProgress({ data: { document: progress.document } }),
    )
    if (ok) onClose()
  }

  return (
    <AlertDialog
      open={progress !== null}
      onOpenChange={(open) => {
        if (open) return
        setError('')
        onClose()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Reset progress for {progress?.book?.title ?? 'this book'}?
          </AlertDialogTitle>
        </AlertDialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={onConfirm}
          >
            Reset
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
