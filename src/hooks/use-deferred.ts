import { useEffect, useState } from 'react'

// Loads secondary data after the page renders, so a slow or failing request
// never holds the page up. Undefined while it loads for the current `key`,
// null when it fails.
export function useDeferred<T>(key: string, load: () => Promise<T>) {
  const [state, setState] = useState<{ key: string; data: T | null } | null>(
    null,
  )
  useEffect(() => {
    let current = true
    load()
      .catch(() => null)
      .then((data) => current && setState({ key, data }))
    return () => {
      current = false
    }
    // `load` is a new closure every render; `key` names what it loads.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state?.key === key ? state.data : undefined
}
