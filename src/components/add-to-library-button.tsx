import { Link } from '@tanstack/react-router'
import { Check, Loader2, Plus } from 'lucide-react'

import { Button } from '#/components/ui/button'

export type AddState =
  | { status: 'idle' | 'adding' }
  | { status: 'added'; bookId: string }
  | { status: 'error'; message: string }

// Adds a Market book; once it's in the library, opens it there.
export function AddToLibraryButton({
  state,
  onAdd,
  disabled,
  size,
  className,
}: {
  state: AddState
  onAdd: () => void
  disabled?: boolean
  size?: 'sm' | 'default'
  className?: string
}) {
  if (state.status === 'added') {
    return (
      <Button asChild variant="secondary" size={size} className={className}>
        <Link to="/books/$bookId" params={{ bookId: state.bookId }}>
          <Check />
          In library
        </Link>
      </Button>
    )
  }
  const adding = state.status === 'adding'
  return (
    <Button
      variant={size === 'sm' ? 'outline' : 'default'}
      size={size}
      className={className}
      disabled={adding || disabled}
      onClick={onAdd}
    >
      {adding ? <Loader2 className="animate-spin" /> : <Plus />}
      {adding ? 'Adding…' : 'Add to library'}
    </Button>
  )
}
