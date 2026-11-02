import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'

// Runs a server function, keeps its error for inline display, and reloads the
// route data on success.
export function useAction() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function run(action: () => Promise<unknown>) {
    setPending(true)
    setError('')
    try {
      await action()
      await router.invalidate()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
      return false
    } finally {
      setPending(false)
    }
  }

  return { error, setError, pending, run }
}
