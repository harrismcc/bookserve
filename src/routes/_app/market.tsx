import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Link,
  createFileRoute,
  redirect,
  useNavigate,
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
import { mergeBooks, mergeHome, mergeShelves } from '#/lib/market/merge'
import type { MergedBook, MergedShelf, SourceRef } from '#/lib/market/merge'
import type { BookDetails, Home, Listing } from '#/lib/market/sdk'

type MarketSearch = { q?: string; shelf?: SourceRef[] }

// The router parses values as JSON, so a numeric query arrives as a number.
function validateShelf(value: unknown) {
  if (!Array.isArray(value)) return undefined
  const refs = value.flatMap((r: Record<string, unknown>) =>
    Number(r?.source) && typeof r?.id === 'string'
      ? [{ source: Number(r.source), id: r.id }]
      : [],
  )
  return refs.length ? refs : undefined
}

type Source = Awaited<ReturnType<typeof listMarketSources>>[number]
type InLibrary = Record<string, string>

// Browses every source set up in Settings → Market sources at once: their
// homes, a shelf (`shelf`: one id per source, for shelves merged by name) or
// search results (`q`). The same book from several sources is shown once.
export const Route = createFileRoute('/_app/market')({
  beforeLoad: ({ context }) => {
    if (context.user.role !== 'admin') throw redirect({ to: '/' })
  },
  validateSearch: (search: Record<string, unknown>): MarketSearch => ({
    q:
      typeof search.q === 'string' || typeof search.q === 'number'
        ? String(search.q)
        : undefined,
    shelf: validateShelf(search.shelf),
  }),
  loader: () => listMarketSources(),
  component: Market,
})

type SourceResult = {
  source: number
  sourceName: string
  loading: boolean
  error: string | null
  home: Home | null
  pages: Listing[]
  cursor: string | null
}

const message = (err: unknown) =>
  err instanceof Error ? err.message : 'Request failed'

// Loads the view from each source on its own and keeps their results (and
// pages) apart; the views merge them. Which books are in the library is kept
// for every offer seen, so adding a book shows everywhere it appears.
function useMarket(sources: Source[], search: MarketSearch) {
  const [results, setResults] = useState<SourceResult[]>([])
  const [inLibrary, setInLibrary] = useState<InLibrary>({})
  const key = JSON.stringify([search.q, search.shelf])
  // Bumped per search, so answers for an earlier one are dropped.
  const generation = useRef(0)

  const update = (source: number, change: Partial<SourceResult>) =>
    setResults((prev) =>
      prev.map((r) => (r.source === source ? { ...r, ...change } : r)),
    )
  const remember = (found: InLibrary) =>
    setInLibrary((prev) => ({ ...prev, ...found }))

  useEffect(() => {
    const gen = ++generation.current
    const current = () => gen === generation.current
    const targets = sources.flatMap(
      (s): Array<{ s: Source; shelf?: string }> => {
        if (search.q) return s.searchable ? [{ s }] : []
        if (!search.shelf) return [{ s }]
        const ref = search.shelf.find((r) => r.source === s.id)
        return ref ? [{ s, shelf: ref.id }] : []
      },
    )
    setResults(
      targets.map(({ s }) => ({
        source: s.id,
        sourceName: s.name,
        loading: true,
        error: null,
        home: null,
        pages: [],
        cursor: null,
      })),
    )
    for (const { s, shelf } of targets) {
      marketBrowse({ data: { sourceId: s.id, q: search.q, shelf } }).then(
        (view) => {
          if (!current()) return
          remember(view.inLibrary)
          update(
            s.id,
            view.kind === 'home'
              ? { loading: false, home: view.home }
              : {
                  loading: false,
                  pages: [view.listing],
                  cursor: view.listing.nextCursor,
                },
          )
        },
        (err) =>
          current() && update(s.id, { loading: false, error: message(err) }),
      )
    }
    // `key` covers the search; sources only change on reload.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sources])

  // The next page from every source that has one. A source that fails keeps
  // its cursor, so "Load more" retries it.
  function loadMore() {
    const gen = generation.current
    for (const r of results.filter((p) => p.cursor && !p.loading)) {
      update(r.source, { loading: true, error: null })
      const ref = search.shelf?.find((s) => s.source === r.source)
      marketBrowse({
        data: {
          sourceId: r.source,
          q: search.q,
          shelf: ref?.id,
          cursor: r.cursor!,
        },
      }).then(
        (view) => {
          if (gen !== generation.current || view.kind !== 'listing') return
          remember(view.inLibrary)
          setResults((prev) =>
            prev.map((p) =>
              p.source === r.source
                ? {
                    ...p,
                    loading: false,
                    pages: [...p.pages, view.listing],
                    cursor: view.listing.nextCursor,
                  }
                : p,
            ),
          )
        },
        (err) =>
          gen === generation.current &&
          update(r.source, { loading: false, error: message(err) }),
      )
    }
  }

  return {
    results,
    inLibrary,
    loadMore,
    markAdded: (offer: SourceRef, bookId: string) =>
      remember({ [`${offer.source}:${offer.id}`]: bookId }),
  }
}

type Market = ReturnType<typeof useMarket>

const libraryId = (book: MergedBook, inLibrary: InLibrary) =>
  book.offers.map((o) => inLibrary[`${o.source}:${o.id}`]).find(Boolean)

function Market() {
  const sources = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const market = useMarket(sources, search)
  const loading = market.results.some((r) => r.loading)

  if (!sources.length) {
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

  const errors = market.results.filter((r) => r.error)

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Market</h1>

      {sources.some((s) => s.searchable) && (
        <form
          key={search.q}
          className="relative mt-6"
          onSubmit={(e) => {
            e.preventDefault()
            const q = String(new FormData(e.currentTarget).get('q')).trim()
            void navigate({ search: { q: q || undefined } })
          }}
        >
          <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            name="q"
            placeholder="Search"
            aria-label="Search the Market"
            defaultValue={search.q}
            className="h-12 rounded-full pl-12 text-base md:text-base"
          />
          {loading && (
            <Loader2 className="absolute top-1/2 right-4 size-5 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </form>
      )}

      <div className="mt-8 grid gap-8">
        {errors.length > 0 && (
          <div className="grid gap-1">
            {errors.map((r) => (
              <p key={r.source} className="text-sm text-destructive">
                Could not load {r.sourceName}: {r.error}
              </p>
            ))}
          </div>
        )}
        {search.q || search.shelf ? (
          <ListingView market={market} multiSource={sources.length > 1} />
        ) : (
          <HomeView market={market} multiSource={sources.length > 1} />
        )}
      </div>
    </main>
  )
}

function Loading() {
  return (
    <div className="flex min-h-48 items-center justify-center text-muted-foreground">
      <Loader2 className="size-6 animate-spin" />
    </div>
  )
}

function HomeView({
  market,
  multiSource,
}: {
  market: Market
  multiSource: boolean
}) {
  const { results } = market
  const { rows, shelves } = useMemo(
    () =>
      mergeHome(
        results.flatMap((r) =>
          r.home
            ? [{ ...r.home, source: r.source, sourceName: r.sourceName }]
            : [],
        ),
      ),
    [results],
  )
  if (!rows.length && !shelves.length) {
    return results.some((r) => r.loading) ? <Loading /> : null
  }
  return (
    <div className="grid gap-10">
      {rows.map((row) => (
        <section
          key={row.refs.map((r) => `${r.source}:${r.id}`).join(' ')}
          className="min-w-0"
        >
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 className="text-xl font-semibold">{row.title}</h2>
            <Link
              to="/market"
              search={{ shelf: row.refs }}
              className="flex items-center text-sm text-muted-foreground hover:text-foreground"
            >
              See all
              <ChevronRight className="size-4" />
            </Link>
          </div>
          <ul className="-mx-4 flex snap-x scroll-px-4 gap-5 overflow-x-auto px-4 pb-2">
            {row.books.map((book) => (
              <li
                key={`${book.offers[0].source}:${book.offers[0].id}`}
                className="w-36 shrink-0 snap-start sm:w-40"
              >
                <BookCard
                  book={book}
                  market={market}
                  multiSource={multiSource}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {shelves.length > 0 && (
        <section>
          <h2 className="mb-4 text-xl font-semibold">Browse</h2>
          <ShelfGrid shelves={shelves} />
        </section>
      )}
    </div>
  )
}

function ListingView({
  market,
  multiSource,
}: {
  market: Market
  multiSource: boolean
}) {
  const search = Route.useSearch()
  const { results } = market
  // Page by page, so a source's later pages never jump ahead of another's
  // earlier ones.
  const books = useMemo(() => {
    let merged: MergedBook[] = []
    const pages = Math.max(0, ...results.map((r) => r.pages.length))
    for (let i = 0; i < pages; i++) {
      merged = mergeBooks(
        merged,
        results.map((r) => ({ ...r, items: r.pages[i]?.books ?? [] })),
      )
    }
    return merged
  }, [results])
  const shelves = useMemo(
    () =>
      mergeShelves(
        results.map((r) => ({ ...r, items: r.pages[0]?.shelves ?? [] })),
      ),
    [results],
  )
  const title =
    search.q ?? results.find((r) => r.pages[0])?.pages[0].title ?? 'Market'
  const loading = results.some((r) => r.loading)
  const hasMore = results.some((r) => r.cursor)
  const empty = !books.length && !shelves.length

  return (
    <div className="grid gap-8">
      <nav className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
        <Link to="/market" className="shrink-0 hover:text-foreground">
          Market
        </Link>
        <ChevronRight className="size-4 shrink-0" />
        <h2 className="truncate font-medium text-foreground">{title}</h2>
      </nav>

      {shelves.length > 0 && <ShelfGrid shelves={shelves} />}

      {empty && loading && <Loading />}
      {empty && !loading && (
        <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-muted-foreground">
          <Search className="size-8" />
          <p className="text-sm">Nothing found</p>
        </div>
      )}

      {books.length > 0 && (
        <ul className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {books.map((book) => (
            <li key={`${book.offers[0].source}:${book.offers[0].id}`}>
              <BookCard book={book} market={market} multiSource={multiSource} />
            </li>
          ))}
        </ul>
      )}

      {hasMore && !empty && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={market.loadMore}
            disabled={loading}
          >
            {loading && <Loader2 className="animate-spin" />}
            {loading ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  )
}

function ShelfGrid({ shelves }: { shelves: MergedShelf[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {shelves.map((shelf) => (
        <li key={shelf.refs.map((r) => `${r.source}:${r.id}`).join(' ')}>
          <Link
            to="/market"
            search={{ shelf: shelf.refs }}
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
// format from the first source that has one (the dialog lets you pick).
function BookCard({
  book,
  market,
  multiSource,
}: {
  book: MergedBook
  market: Market
  multiSource: boolean
}) {
  const [open, setOpen] = useState(false)
  const [local, setLocal] = useState<AddState>({ status: 'idle' })
  const libraryBookId = libraryId(book, market.inLibrary)
  const state: AddState = libraryBookId
    ? { status: 'added', bookId: libraryBookId }
    : local

  async function addOffer(offer: SourceRef, formatId: string) {
    const { bookId } = await marketAdd({
      data: { sourceId: offer.source, bookId: offer.id, formatId },
    })
    market.markAdded(offer, bookId)
  }

  // Tries each source in turn until one has an EPUB that downloads.
  async function add(choice?: SourceRef & { formatId: string }) {
    setLocal({ status: 'adding' })
    let error = 'No EPUB available'
    for (const offer of choice ? [choice] : book.offers) {
      try {
        const formatId =
          choice?.formatId ??
          (
            await marketBook({
              data: { sourceId: offer.source, bookId: offer.id },
            })
          ).book.formats[0]?.id
        if (!formatId) continue
        await addOffer(offer, formatId)
        setLocal({ status: 'idle' })
        return
      } catch (err) {
        error = message(err)
      }
    }
    setLocal({ status: 'error', message: error })
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
          book={book}
          multiSource={multiSource}
          onClose={() => setOpen(false)}
          state={state}
          onInLibrary={market.markAdded}
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

type OfferDetails = {
  source: number
  sourceName: string
  id: string
  book: BookDetails | null
  error: string | null
}

// Loads the book's details from every source that has it when opened. Shows
// the first source's details and every source's formats.
function BookDialog({
  book,
  multiSource,
  onClose,
  state,
  onInLibrary,
  onAdd,
}: {
  book: MergedBook
  multiSource: boolean
  onClose: () => void
  state: AddState
  onInLibrary: (offer: SourceRef, bookId: string) => void
  onAdd: (offer: SourceRef & { formatId: string }) => void
}) {
  const [offers, setOffers] = useState<OfferDetails[] | null>(null)
  const [choice, setChoice] = useState<string>()
  // Reload only when the offers change, not on every merge of the list.
  const offersKey = book.offers.map((o) => `${o.source}:${o.id}`).join(' ')

  useEffect(() => {
    let current = true
    void Promise.all(
      book.offers.map(async (offer) => {
        try {
          const result = await marketBook({
            data: { sourceId: offer.source, bookId: offer.id },
          })
          if (result.libraryBookId && current) {
            onInLibrary(offer, result.libraryBookId)
          }
          return { ...offer, book: result.book, error: null }
        } catch (err) {
          return { ...offer, book: null, error: message(err) }
        }
      }),
    ).then((loaded) => {
      if (!current) return
      setOffers(loaded)
      const first = loaded.find((o) => o.book?.formats.length)
      // Keep the user's choice when the offers change, if it still exists.
      setChoice((prev) =>
        loaded.some((o) =>
          o.book?.formats.some((f) => `${o.source}|${f.id}` === prev),
        )
          ? prev
          : first && `${first.source}|${first.book!.formats[0].id}`,
      )
    })
    return () => {
      current = false
    }
    // onInLibrary is a fresh closure each render.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [offersKey])

  const details = offers?.find((o) => o.book)?.book
  const shown = details ?? book
  const formats = (offers ?? []).flatMap((o) =>
    (o.book?.formats ?? []).map((f) => ({
      ...f,
      key: `${o.source}|${f.id}`,
      offer: o,
      text: [multiSource && o.sourceName, f.label, formatSize(f.size)]
        .filter(Boolean)
        .join(' · '),
    })),
  )
  const format = formats.find((f) => f.key === choice)
  const added = state.status === 'added'
  const description = offers?.map((o) => o.book?.description).find(Boolean)
  const shelves = (offers ?? []).flatMap((o) =>
    (o.book?.shelves ?? []).map((s) => ({ ...s, source: o.source })),
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <div className="grid gap-6 sm:grid-cols-[180px_1fr]">
          <BookCover
            title={shown.title}
            authors={shown.authors}
            coverUrl={book.coverUrl ?? shown.coverUrl}
            className="mx-auto w-40 sm:w-full"
          />
          <div className="flex min-w-0 flex-col gap-4">
            <div className="grid gap-1 pr-6">
              <DialogTitle className="text-xl leading-tight">
                {shown.title}
              </DialogTitle>
              <DialogDescription>{shown.authors.join(', ')}</DialogDescription>
            </div>

            {!offers && (
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            )}
            {offers
              ?.filter((o) => o.error)
              .map((o) => (
                <p key={o.source} className="text-sm text-destructive">
                  Could not load {o.sourceName}: {o.error}
                </p>
              ))}

            {offers && formats.length === 0 && !added && (
              <p className="text-sm text-muted-foreground">No EPUB available</p>
            )}
            {offers && (formats.length > 0 || added) && (
              <>
                {formats.length > 1 && !added && (
                  <Select value={choice} onValueChange={setChoice}>
                    <SelectTrigger aria-label="Format" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {formats.map((f) => (
                        <SelectItem key={f.key} value={f.key}>
                          {f.text}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <AddButton
                    state={state}
                    disabled={!format}
                    onAdd={() =>
                      format &&
                      onAdd({
                        source: format.offer.source,
                        id: format.offer.id,
                        formatId: format.id,
                      })
                    }
                  />
                  {formats.length === 1 && !added && (
                    <span className="text-sm text-muted-foreground">
                      {formats[0].text}
                    </span>
                  )}
                </div>
              </>
            )}
            {state.status === 'error' && (
              <p className="text-sm text-destructive">{state.message}</p>
            )}

            {description && (
              <p className="text-sm leading-relaxed whitespace-pre-line text-muted-foreground">
                {description}
              </p>
            )}

            {shelves.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {shelves.map((shelf) => (
                  <li key={`${shelf.source}:${shelf.id}`}>
                    <Link
                      to="/market"
                      search={{
                        shelf: [{ source: shelf.source, id: shelf.id }],
                      }}
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
