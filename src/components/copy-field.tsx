import { useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'

export function CopyField({ id, value }: { id: string; value: string }) {
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
