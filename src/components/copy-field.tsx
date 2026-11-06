import { useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '#/components/ui/input-group'

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
    <InputGroup>
      <InputGroupInput
        ref={input}
        id={id}
        value={value}
        readOnly
        onFocus={(event) => event.currentTarget.select()}
        className="font-mono"
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" aria-label="Copy" onClick={copy}>
          {copied ? <Check /> : <Copy />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}
