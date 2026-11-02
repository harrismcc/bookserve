import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Trash2 } from 'lucide-react'

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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
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
  addMarketSource,
  listIntegrations,
  listMarketSources,
  removeMarketSource,
} from '#/lib/market-functions'

export const Route = createFileRoute('/_app/settings/market')({
  loader: async () => {
    const [sources, integrations] = await Promise.all([
      listMarketSources(),
      listIntegrations(),
    ])
    return { sources, integrations }
  },
  component: MarketSources,
})

type Source = Awaited<ReturnType<typeof listMarketSources>>[number]
type Integration = Awaited<ReturnType<typeof listIntegrations>>[number]

function MarketSources() {
  const { sources, integrations } = Route.useLoaderData()
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<Source | null>(null)

  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Market sources</h2>
        <Button onClick={() => setAdding(true)}>Add source</Button>
      </div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sources.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={3}
                  className="py-8 text-center text-muted-foreground"
                >
                  No sources
                </TableCell>
              </TableRow>
            )}
            {sources.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="max-w-0 pl-4">
                  <p className="truncate font-medium">{s.name}</p>
                  {s.settings.url && (
                    <p className="truncate text-xs text-muted-foreground">
                      {s.settings.url}
                    </p>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {s.integration}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${s.name}`}
                    onClick={() => setRemoving(s)}
                  >
                    <Trash2 />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <AddSourceDialog
        integrations={integrations}
        open={adding}
        onOpenChange={setAdding}
      />
      <RemoveSourceDialog source={removing} onClose={() => setRemoving(null)} />
    </section>
  )
}

function AddSourceDialog({
  integrations,
  open,
  onOpenChange,
}: {
  integrations: Integration[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { error, setError, pending, run } = useAction()
  const [integrationId, setIntegrationId] = useState(integrations[0]?.id)
  const integration = integrations.find((i) => i.id === integrationId)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!integration) return
    const form = new FormData(event.currentTarget)
    const ok = await run(() =>
      addMarketSource({
        data: {
          integration: integration.id,
          name: String(form.get('name')),
          settings: Object.fromEntries(
            integration.settings.map((f) => [
              f.key,
              String(form.get(`setting-${f.key}`) ?? ''),
            ]),
          ),
        },
      }),
    )
    if (ok) onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setError('')
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add source</DialogTitle>
        </DialogHeader>
        <form key={integrationId} onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="source-type">Type</Label>
            <Select value={integrationId} onValueChange={setIntegrationId}>
              <SelectTrigger id="source-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {integrations.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="source-name">Name</Label>
            <Input
              id="source-name"
              name="name"
              autoComplete="off"
              placeholder={integration?.name}
            />
          </div>
          {integration?.settings.map((field) => (
            <div key={field.key} className="grid gap-2">
              <Label htmlFor={`setting-${field.key}`}>{field.label}</Label>
              <Input
                id={`setting-${field.key}`}
                name={`setting-${field.key}`}
                type={field.type}
                required={field.required}
                placeholder={field.placeholder}
                autoComplete={
                  field.type === 'password' ? 'new-password' : 'off'
                }
              />
            </div>
          ))}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? 'Connecting…' : 'Add source'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RemoveSourceDialog({
  source,
  onClose,
}: {
  source: Source | null
  onClose: () => void
}) {
  const { error, setError, pending, run } = useAction()

  async function onConfirm(event: React.MouseEvent) {
    event.preventDefault()
    if (!source) return
    const ok = await run(() => removeMarketSource({ data: source.id }))
    if (ok) onClose()
  }

  return (
    <AlertDialog
      open={source !== null}
      onOpenChange={(open) => {
        if (open) return
        setError('')
        onClose()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {source?.name}?</AlertDialogTitle>
        </AlertDialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={onConfirm}
          >
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
