import { createFileRoute } from '@tanstack/react-router'
import { BookOpen } from 'lucide-react'

export const Route = createFileRoute('/_app/')({ component: Library })

function Library() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Library</h1>
      <div className="mt-6 flex min-h-72 flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-muted-foreground">
        <BookOpen className="size-8" />
        <p className="text-sm">No books yet</p>
      </div>
    </main>
  )
}
