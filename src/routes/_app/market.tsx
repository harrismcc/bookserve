import { useEffect, useState } from 'react'
import {
  Link,
  createFileRoute,
  redirect,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import { Check, ChevronRight, Loader2, Plus, Search, Store } from 'lucide-react'

import { BookCover } from '#/components/book-cover'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import {
  listMarketSources,
  marketAdd,
  marketBook,
  marketBrowse,
} from '#/lib/market-functions'
import type {
  BookDetails,
  BookSummary,
  Listing,
  ShelfLink,
} from '#/lib/market/sdk'
import { cn } from '#/lib/utils'

type MarketSearch = { source?: number; shelf?: string; q?: string }

const text = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : undefined

// Browses the sources set up in Settings → Market sources: the source's home
// (rows of books), a shelf (`shelf`) or search results (`q`).
export const Route = createFileRoute('/_app/market')({
  beforeLoad: ({ context }) => {
    if (context.user.role !== 'admin') throw redirect({ to: '/' })
  },
  // The router parses values as JSON, so a numeric query arrives as a number.
  validateSearch: (search: Record<string, unknown>): MarketSearch => ({
    source: Number(search.source) || undefined,
    shelf: text(search.shelf),
    q: text(search.q),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const sources = await listMarketSources()
    const source = sources.find((s) => s.id === deps.source) ?? sources[0]
    if (!source) return { sources, source: null, view: null }
    const view = await marketBrowse({
      data: { sourceId: source.id, shelf: deps.shelf, q: deps.q },
    })
    return { sources, source, view }
  },
  component: Market,
})

type Source = { id: number; name: string; searchable: boolean }
type InLibrary = Record<string, string>

function Market() {
  const { sources, source, view } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const loading = useRouterState({ select: (s) => s.status === 'pending' })

  if (!source || !view) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="text-2xl font-semibold">Market</h1>
        <div className="mt-6 flex min-h-72 flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-muted-foreground">
          <Store className="size-8" />
          <p className="text-sm">No sources</p>
          <Button asChild variant="outline" size="sm">
            <Link to="/settings/market">Add a source</Link>
          </Button>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold">Market</h1>
        {sources.length > 1 && (
          <Select
            value={String(source.id)}
            onValueChange={(id) => navigate({ search: { source: Number(id) } })}
          >
            <SelectTrigger aria-label="Source" className="w-full sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sources.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {source.searchable && (
        <form
          key={`${source.id} ${search.q}`}
          className="relative mt-6"
          onSubmit={(e) => {
            e.preventDefault()
            const q = String(new FormData(e.currentTarget).get('q')).trim()
            void navigate({ search: { source: source.id, q: q || undefined } })
          }}
        >
          <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            name="q"
            placeholder={`Search ${source.name}`}
            aria-label={`Search ${source.name}`}
            defaultValue={search.q}
            className="h-12 rounded-full pl-12 text-base md:text-base"
          />
          {loading && (
            <Loader2 className="absolute top-1/2 right-4 size-5 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </form>
      )}

      <div className={cn('mt-8 transition-opacity', loading && 'opacity-50')}>
        {view.kind === 'error' && (
          <p className="text-sm text-destructive">
            Could not load {source.name}: {view.error}
          </p>
        )}
        {view.kind === 'home' && (
          <HomeView
            source={source}
            rows={view.home.rows}
            shelves={view.home.shelves}
            inLibrary={view.inLibrary}
          />
        )}
        {view.kind === 'listing' && (
          <ListingView
            key={`${source.id} ${search.shelf} ${search.q}`}
            source={source}
            listing={view.listing}
            inLibrary={view.inLibrary}
          />
        )}
      </div>
    </main>
  )
}

function HomeView({
  source,
  rows,
  shelves,
  inLibrary,
}: {
  source: Source
  rows: Array<ShelfLink & { books: BookSummary[] }>
  shelves: ShelfLink[]
  inLibrary: InLibrary
}) {
  return (
    <div className="grid gap-10">
      {rows.map((row) => (
        <section key={row.id} className="min-w-0">
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 className="text-xl font-semibold">{row.title}</h2>
            <Link
              to="/market"
              search={{ source: source.id, shelf: row.id }}
              className="flex items-center text-sm text-muted-foreground hover:text-foreground"
            >
              See all
              <ChevronRight className="size-4" />
            </Link>
          </div>
          <ul className="-mx-4 flex snap-x scroll-px-4 gap-5 overflow-x-auto px-4 pb-2">
            {row.books.map((book) => (
              <li key={book.id} className="w-36 shrink-0 snap-start sm:w-40">
                <BookCard
                  source={source}
                  book={book}
                  libraryBookId={inLibrary[book.id]}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {shelves.length > 0 && (
        <section>
          <h2 className="mb-4 text-xl font-semibold">Browse</h2>
          <ShelfGrid source={source} shelves={shelves} />
        </section>
      )}
    </div>
  )
}

function ListingView({
  source,
  listing,
  inLibrary: initialInLibrary,
}: {
  source: Source
  listing: Listing
  inLibrary: InLibrary
}) {
  const search = Route.useSearch()
  const [books, setBooks] = useState(listing.books)
  const [inLibrary, setInLibrary] = useState(initialInLibrary)
  const [cursor, setCursor] = useState(listing.nextCursor)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')

  async function loadMore() {
    if (!cursor) return
    setLoadingMore(true)
    setError('')
    const next = await marketBrowse({
      data: { sourceId: source.id, shelf: search.shelf, q: search.q, cursor },
    }).catch((err: Error) => ({ kind: 'error' as const, error: err.message }))
    setLoadingMore(false)
    if (next.kind !== 'listing') {
      setError(next.kind === 'error' ? next.error : 'Could not load more')
      return
    }
    // Pages can overlap when the catalog changes between requests.
    setBooks((prev) => {
      const seen = new Set(prev.map((b) => b.id))
      return [...prev, ...next.listing.books.filter((b) => !seen.has(b.id))]
    })
    setInLibrary((prev) => ({ ...prev, ...next.inLibrary }))
    setCursor(next.listing.nextCursor)
  }

  return (
    <div className="grid gap-8">
      <nav className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
        <Link
          to="/market"
          search={{ source: source.id }}
          className="shrink-0 hover:text-foreground"
        >
          {source.name}
        </Link>
        <ChevronRight className="size-4 shrink-0" />
        <h2 className="truncate font-medium text-foreground">
          {listing.title}
        </h2>
      </nav>

      {listing.shelves.length > 0 && (
        <ShelfGrid source={source} shelves={listing.shelves} />
      )}

      {books.length === 0 && listing.shelves.length === 0 && (
        <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-muted-foreground">
          <Search className="size-8" />
          <p className="text-sm">Nothing found</p>
        </div>
      )}

      {books.length > 0 && (
        <ul className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {books.map((book) => (
            <li key={book.id}>
              <BookCard
                source={source}
                book={book}
                libraryBookId={inLibrary[book.id]}
              />
            </li>
          ))}
        </ul>
      )}

      {(cursor || error) && (
        <div className="flex flex-col items-center gap-2">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {cursor && (
            <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
              {loadingMore && <Loader2 className="animate-spin" />}
              {loadingMore ? 'Loading…' : 'Load more'}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function ShelfGrid({
  source,
  shelves,
}: {
  source: Source
  shelves: ShelfLink[]
}) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {shelves.map((shelf) => (
        <li key={shelf.id}>
          <Link
            to="/market"
            search={{ source: source.id, shelf: shelf.id }}
            className="group flex h-full items-center gap-3 rounded-xl border bg-card px-4 py-3.5 transition-colors hover:bg-accent"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{shelf.title}</p>
              {shelf.description && (
                <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                  {shelf.description}
                </p>
              )}
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
        </li>
      ))}
    </ul>
  )
}

type AddState =
  | { status: 'idle' | 'adding' }
  | { status: 'added'; bookId: string }
  | { status: 'error'; message: string }

function formatSize(bytes: number | null) {
  if (!bytes) return null
  return bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1000))} KB`
}

// A book: the cover and title open its details; the button adds the best
// format (the dialog lets you pick another).
function BookCard({
  source,
  book,
  libraryBookId,
}: {
  source: Source
  book: BookSummary
  libraryBookId: string | undefined
}) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<AddState>(
    libraryBookId
      ? { status: 'added', bookId: libraryBookId }
      : { status: 'idle' },
  )

  async function add(formatId?: string) {
    setState({ status: 'adding' })
    try {
      if (!formatId) {
        const { book: details } = await marketBook({
          data: { sourceId: source.id, bookId: book.id },
        })
        formatId = details.formats[0]?.id
        if (!formatId) throw new Error('No EPUB available')
      }
      const { bookId } = await marketAdd({
        data: { sourceId: source.id, bookId: book.id, formatId },
      })
      setState({ status: 'added', bookId })
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Download failed',
      })
    }
  }

  return (
    <div className="flex h-full flex-col">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group text-left"
      >
        <BookCover
          title={book.title}
          authors={book.authors}
          coverUrl={book.coverUrl}
          className="transition duration-200 group-hover:-translate-y-1 group-hover:shadow-lg"
        />
        <p className="mt-3 line-clamp-2 text-sm leading-snug font-medium">
          {book.title}
        </p>
        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
          {book.authors.join(', ')}
        </p>
      </button>
      <div className="mt-auto pt-3">
        <AddButton
          state={state}
          onAdd={() => add()}
          size="sm"
          className="w-full"
        />
        {state.status === 'error' && (
          <p className="mt-1 text-xs text-destructive">{state.message}</p>
        )}
      </div>
      {open && (
        <BookDialog
          source={source}
          book={book}
          onClose={() => setOpen(false)}
          state={state}
          onAdded={(bookId) => setState({ status: 'added', bookId })}
          onAdd={add}
        />
      )}
    </div>
  )
}

function AddButton({
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

// Loads the book's details when opened.
function BookDialog({
  source,
  book,
  onClose,
  state,
  onAdded,
  onAdd,
}: {
  source: Source
  book: BookSummary
  onClose: () => void
  state: AddState
  onAdded: (bookId: string) => void
  onAdd: (formatId: string) => void
}) {
  const [details, setDetails] = useState<BookDetails | null>(null)
  const [error, setError] = useState('')
  const [formatId, setFormatId] = useState<string>()

  useEffect(() => {
    let current = true
    marketBook({ data: { sourceId: source.id, bookId: book.id } })
      .then((result) => {
        if (!current) return
        setDetails(result.book)
        setFormatId(result.book.formats[0]?.id)
        if (result.libraryBookId) onAdded(result.libraryBookId)
      })
      .catch((err: Error) => current && setError(err.message))
    return () => {
      current = false
    }
    // Loads once per open; onAdded is a fresh closure each render.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [source.id, book.id])

  const shown = details ?? book
  const formats = details?.formats ?? []
  const format = formats.find((f) => f.id === formatId)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <div className="grid gap-6 sm:grid-cols-[180px_1fr]">
          <BookCover
            title={shown.title}
            authors={shown.authors}
            coverUrl={shown.coverUrl}
            className="mx-auto w-40 sm:w-full"
          />
          <div className="flex min-w-0 flex-col gap-4">
            <div className="grid gap-1 pr-6">
              <DialogTitle className="text-xl leading-tight">
                {shown.title}
              </DialogTitle>
              <DialogDescription>{shown.authors.join(', ')}</DialogDescription>
            </div>

            {!details && !error && (
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}

            {details && formats.length === 0 && state.status !== 'added' && (
              <p className="text-sm text-muted-foreground">No EPUB available</p>
            )}
            {details && (formats.length > 0 || state.status === 'added') && (
              <>
                {formats.length > 1 && state.status !== 'added' && (
                  <Select value={formatId} onValueChange={setFormatId}>
                    <SelectTrigger aria-label="Format" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {formats.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {[f.label, formatSize(f.size)]
                            .filter(Boolean)
                            .join(' · ')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <AddButton
                    state={state}
                    disabled={!format}
                    onAdd={() => format && onAdd(format.id)}
                  />
                  {formats.length === 1 && formatSize(formats[0].size) && (
                    <span className="text-sm text-muted-foreground">
                      {formatSize(formats[0].size)}
                    </span>
                  )}
                </div>
              </>
            )}
            {state.status === 'error' && (
              <p className="text-sm text-destructive">{state.message}</p>
            )}

            {details?.description && (
              <p className="text-sm leading-relaxed whitespace-pre-line text-muted-foreground">
                {details.description}
              </p>
            )}

            {details && details.shelves.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {details.shelves.map((shelf) => (
                  <li key={shelf.id}>
                    <Link
                      to="/market"
                      search={{ source: source.id, shelf: shelf.id }}
                      onClick={onClose}
                      className="block rounded-full border px-3 py-1 text-xs transition-colors hover:bg-accent"
                    >
                      {shelf.title}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
