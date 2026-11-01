import { createFileRoute, useRouter } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { authClient } from '#/lib/auth-client'

export const Route = createFileRoute('/_app/')({ component: Library })

function Library() {
  const router = useRouter()

  async function signOut() {
    await authClient.signOut()
    await router.invalidate()
  }

  return (
    <main className="flex items-center justify-between p-8">
      <h1 className="text-2xl font-semibold">Library</h1>
      <Button variant="outline" onClick={signOut}>
        Sign out
      </Button>
    </main>
  )
}
