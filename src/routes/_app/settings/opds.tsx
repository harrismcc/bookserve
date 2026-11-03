import { useRef, useState } from 'react'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { Check, Copy } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
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
          <label htmlFor="opds-url">Catalog URL</label>
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

function CopyField({ id, value }: { id: string; value: string }) {
  const input = useRef<HTMLInputElement>(null)
  const [copied, setCopied] = useState(false)

  // The clipboard API needs a secure context, which plain-http LAN access
  // isn't; there, select the text for a manual copy instead.
  async function copy() {
    if (!navigator.clipboard) return input.current?.select()
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex gap-2">
      <Input
        ref={input}
        id={id}
        value={value}
        readOnly
        onFocus={(event) => event.currentTarget.select()}
        className="font-mono"
      />
      <Button variant="outline" size="icon" aria-label="Copy" onClick={copy}>
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  )
}
