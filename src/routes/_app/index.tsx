import { useRef, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { BookOpen, RefreshCw, Upload } from 'lucide-react'

import { BookGrid } from '#/components/book-grid'
import { Button } from '#/components/ui/button'
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#/components/ui/empty'
import { Input } from '#/components/ui/input'
import { listBooks, scanLibraryNow } from '#/lib/book-functions'
import { cn } from '#/lib/utils'

export const Route = createFileRoute('/_app/')({
  loader: () => listBooks(),
  component: Library,
})

function Library() {
  const books = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const shown = q
    ? books.filter((b) =>
        [b.title, ...b.authors].some((s) => s.toLowerCase().includes(q)),
      )
    : books

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold">Library</h1>
        {books.length > 0 && (
          <Input
            type="search"
            placeholder="Search"
            aria-label="Search title or author"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full sm:w-56"
          />
        )}
        {user.role === 'admin' && <AdminActions />}
      </div>
      {shown.length === 0 ? (
        <Empty className="mt-6 min-h-72 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BookOpen />
            </EmptyMedia>
            <EmptyTitle>
              {books.length ? 'No matches' : 'No books yet'}
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="mt-6">
          <BookGrid books={shown} />
        </div>
      )}
    </main>
  )
}

function AdminActions() {
  const router = useRouter()
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'scan' | 'upload' | null>(null)
  const [error, setError] = useState('')

  async function run(kind: 'scan' | 'upload', action: () => Promise<void>) {
    setBusy(kind)
    setError('')
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setBusy(null)
      await router.invalidate()
    }
  }

  const scan = () =>
    run('scan', async () => {
      const result = await scanLibraryNow()
      if (result.error) throw new Error(result.error)
    })

  const upload = (files: File[]) =>
    run('upload', async () => {
      const failed: string[] = []
      for (const file of files) {
        const res = await fetch(
          `/api/books/upload?name=${encodeURIComponent(file.name)}`,
          { method: 'POST', body: file },
        )
        if (!res.ok) failed.push(await res.text())
      }
      if (failed.length) throw new Error(failed.join('. '))
    })

  return (
    <>
      <Button variant="outline" onClick={scan} disabled={busy !== null}>
        <RefreshCw className={cn(busy === 'scan' && 'animate-spin')} />
        Scan library
      </Button>
      <Button
        onClick={() => fileInput.current?.click()}
        disabled={busy !== null}
      >
        <Upload className={cn(busy === 'upload' && 'animate-pulse')} />
        Upload
      </Button>
      <input
        ref={fileInput}
        type="file"
        accept=".epub,application/epub+zip"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (files.length) void upload(files)
        }}
      />
      {error && <p className="w-full text-sm text-destructive">{error}</p>}
    </>
  )
}
