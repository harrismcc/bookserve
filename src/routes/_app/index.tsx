import { useRef, useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { BookOpen, RefreshCw, Upload } from 'lucide-react'

import { BookCover } from '#/components/book-cover'
import { Button } from '#/components/ui/button'
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
        <div className="mt-6 flex min-h-72 flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-muted-foreground">
          <BookOpen className="size-8" />
          <p className="text-sm">
            {books.length ? 'No matches' : 'No books yet'}
          </p>
        </div>
      ) : (
        <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {shown.map((book) => (
            <li
              key={book.id}
              className={cn(book.missing && 'opacity-50 grayscale')}
            >
              <Link
                to="/books/$bookId"
                params={{ bookId: book.id }}
                className="group block"
              >
                <BookCover
                  {...book}
                  className="transition-shadow group-hover:shadow-md"
                />
                <p className="mt-2 line-clamp-2 text-sm font-medium">
                  {book.title}
                </p>
                <p className="line-clamp-1 text-xs text-muted-foreground">
                  {book.authors.join(', ')}
                </p>
              </Link>
            </li>
          ))}
        </ul>
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
