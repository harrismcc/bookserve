import { Link, createFileRoute, redirect } from '@tanstack/react-router'

import { CopyField } from '#/components/copy-field'
import { Label } from '#/components/ui/label'
import { Switch } from '#/components/ui/switch'
import { useAction } from '#/hooks/use-action'
import { cn } from '#/lib/utils'
import { getOpdsSettings, setOpdsEnabled } from '#/lib/settings-functions'

export const Route = createFileRoute('/_app/settings/opds')({
  beforeLoad: ({ context }) => {
    if (context.user.role !== 'admin') throw redirect({ to: '/settings' })
  },
  loader: () => getOpdsSettings(),
  component: OpdsServer,
})

function OpdsServer() {
  const { enabled, url } = Route.useLoaderData()
  const { error, pending, run } = useAction()

  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">OPDS server</h2>
        <div className="flex items-center gap-2">
          <Label htmlFor="opds-enabled">Enabled</Label>
          <Switch
            id="opds-enabled"
            checked={enabled}
            disabled={pending}
            onCheckedChange={(next) =>
              run(() => setOpdsEnabled({ data: next }))
            }
          />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <dl
        className={cn(
          'grid gap-4 rounded-lg border p-4 text-sm sm:grid-cols-[8rem_1fr] sm:items-center',
          !enabled && 'opacity-50',
        )}
      >
        <dt className="text-muted-foreground">
          <Label
            htmlFor="opds-url"
            className="font-normal text-muted-foreground"
          >
            Catalog URL
          </Label>
        </dt>
        <dd>
          <CopyField id="opds-url" value={url} />
        </dd>
        <dt className="text-muted-foreground">Sign in with</dt>
        <dd>
          Bookserve username and an{' '}
          <Link to="/settings/api-keys" className="underline">
            API key
          </Link>
        </dd>
      </dl>
    </section>
  )
}
