import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { KeyRound, Trash2 } from 'lucide-react'

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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
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
  createApiKey,
  deleteApiKey,
  listApiKeys,
} from '#/lib/api-key-functions'

// A user's keys for reading apps: the password for KOReader progress sync
// (/kosync) and the OPDS catalog (/opds).
export const Route = createFileRoute('/_app/settings/api-keys')({
  loader: () => listApiKeys(),
  head: () => ({ meta: [{ title: 'API keys · Bookserve' }] }),
  component: ApiKeys,
})

type ApiKey = Awaited<ReturnType<typeof listApiKeys>>[number]

function ApiKeys() {
  const keys = Route.useLoaderData()
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<ApiKey | null>(null)

  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">API keys</h2>
        <Button onClick={() => setCreating(true)}>Create key</Button>
      </div>
      {keys.length === 0 ? (
        <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-muted-foreground">
          <KeyRound className="size-8" />
          <p className="text-sm">No API keys</p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Name</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((key) => (
                <TableRow key={key.id}>
                  <TableCell className="pl-4 font-medium">{key.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {key.createdAt.slice(0, 10)}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${key.name}`}
                      onClick={() => setDeleting(key)}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <CreateKeyDialog open={creating} onOpenChange={setCreating} />
      <DeleteKeyDialog apiKey={deleting} onClose={() => setDeleting(null)} />
    </section>
  )
}

function CreateKeyDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { user } = Route.useRouteContext()
  const { error, setError, pending, run } = useAction()
  const [key, setKey] = useState('')

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = String(new FormData(event.currentTarget).get('name'))
    await run(async () => setKey(await createApiKey({ data: { name } })))
  }

  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const settings = [
    ['Username', user.username],
    ['Password', key],
    ['KOReader sync server', `${origin}/kosync`],
    ['OPDS catalog', `${origin}/opds`],
  ]

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) return
        setError('')
        setKey('')
        onOpenChange(false)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{key ? 'Key created' : 'Create key'}</DialogTitle>
        </DialogHeader>
        {key ? (
          <>
            <dl className="grid gap-3 text-sm">
              {settings.map(([label, value]) => (
                <div key={label} className="grid gap-1">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-mono break-all select-all">{value}</dd>
                </div>
              ))}
            </dl>
            <DialogFooter>
              <Button
                onClick={() => {
                  setKey('')
                  onOpenChange(false)
                }}
              >
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={onSubmit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="key-name">Device</Label>
              <Input
                id="key-name"
                name="name"
                placeholder="Kobo Libra"
                autoComplete="off"
                maxLength={50}
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                Create key
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function DeleteKeyDialog({
  apiKey,
  onClose,
}: {
  apiKey: ApiKey | null
  onClose: () => void
}) {
  const { error, setError, pending, run } = useAction()

  async function onConfirm(event: React.MouseEvent) {
    // Keep the dialog open until the request finishes so errors show inline.
    event.preventDefault()
    if (!apiKey) return
    const ok = await run(() => deleteApiKey({ data: { id: apiKey.id } }))
    if (ok) onClose()
  }

  return (
    <AlertDialog
      open={apiKey !== null}
      onOpenChange={(open) => {
        if (open) return
        setError('')
        onClose()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {apiKey?.name}?</AlertDialogTitle>
        </AlertDialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={onConfirm}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
