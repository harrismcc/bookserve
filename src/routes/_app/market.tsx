import { useEffect, useRef, useState } from 'react'
import {
  Link,
  createFileRoute,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { ChevronRight, Loader2, Search, Store } from 'lucide-react'

import { AddToLibraryButton } from '#/components/add-to-library-button'
import type { AddState } from '#/components/add-to-library-button'
import { BookCover } from '#/components/book-cover'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  listMarketSources,
  marketAdd,
  marketBook,
  marketBrowse,
  marketInLibrary,
} from '#/lib/market-functions'
import { mergeBooks, mergeHome, mergeShelves } from '#/lib/market/merge'
import type { MergedBook, MergedShelf, SourceRef } from '#/lib/market/merge'

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

type Answer = {
  source: Source
  view: Awaited<ReturnType<typeof marketBrowse>> | null
  error: string | null
}

type MarketState = {
  loading: boolean
  errors: Array<{ source: number; sourceName: string; error: string }>
  home: ReturnType<typeof mergeHome> | null
  title: string | null
  shelves: MergedShelf[]
  books: MergedBook[]
  // The next page's cursor per source id. A source that fails keeps its
  // cursor, so "Load more" retries it.
  cursors: Record<number, string>
}

const EMPTY: MarketState = {
  loading: true,
  errors: [],
  home: null,
  title: null,
  shelves: [],
  books: [],
  cursors: {},
}

const message = (err: unknown) =>
  err instanceof Error ? err.message : 'Request failed'

// Adds a batch of answers, one per source asked, to what is shown.
function settle(
  prev: MarketState,
  answers: Answer[],
  q: string | undefined,
): MarketState {
  const listings = answers.flatMap((a) =>
    a.view?.kind === 'listing'
      ? [{ source: a.source.id, sourceName: a.source.name, ...a.view.listing }]
      : [],
  )
  const homes = answers.flatMap((a) =>
    a.view?.kind === 'home'
      ? [{ source: a.source.id, sourceName: a.source.name, ...a.view.home }]
      : [],
  )
  const cursors = { ...prev.cursors }
  for (const l of listings) {
    if (l.nextCursor) cursors[l.source] = l.nextCursor
    else delete cursors[l.source]
  }
  return {
    loading: false,
    errors: answers.flatMap((a) =>
      a.error
        ? [{ source: a.source.id, sourceName: a.source.name, error: a.error }]
        : [],
    ),
    home: homes.length ? mergeHome(homes) : prev.home,
    title: prev.title ?? listings[0]?.title ?? null,
    shelves: prev.shelves.length
      ? prev.shelves
      : mergeShelves(listings.map((l) => ({ ...l, items: l.shelves }))),
    books: mergeBooks(
      prev.books,
      listings.map((l) => ({ ...l, items: l.books })),
      q,
    ),
    cursors,
  }
}

// The last listing shown, so coming back from a book page shows it again,
// with every page loaded and the scroll position, instead of reloading it.
let last: { key: string; state: MarketState; inLibrary: InLibrary } | null =
  null

// Loads the view from every source and shows them together once all have
// answered, so nothing moves when a slow source arrives; "Load more" adds the
// next page from each the same way. Which books are in the library is kept
// for every offer seen, so adding a book shows everywhere it appears.
function useMarket(sources: Source[], search: MarketSearch) {
  const key = JSON.stringify([search.q, search.shelf])
  const [restored] = useState(() =>
    last?.key === key && !last.state.loading ? last : null,
  )
  const [state, setState] = useState(restored?.state ?? EMPTY)
  const [inLibrary, setInLibrary] = useState<InLibrary>(
    restored?.inLibrary ?? {},
  )
  // The search whose results `state` holds or is loading.
  const loaded = useRef(restored ? key : null)
  // Bumped per search, so answers for an earlier one are dropped.
  const generation = useRef(0)

  const remember = (found: InLibrary) =>
    setInLibrary((prev) => ({ ...prev, ...found }))

  function browse(targets: Source[], cursors: Record<number, string>) {
    const gen = generation.current
    void Promise.all(
      targets.map((s) =>
        marketBrowse({
          data: {
            sourceId: s.id,
            q: search.q,
            shelf: search.shelf?.find((r) => r.source === s.id)?.id,
            cursor: cursors[s.id],
          },
        }).then(
          (view): Answer => ({ source: s, view, error: null }),
          (err): Answer => ({ source: s, view: null, error: message(err) }),
        ),
      ),
    ).then((answers) => {
      if (gen !== generation.current) return
      for (const a of answers) if (a.view) remember(a.view.inLibrary)
      setState((prev) => settle(prev, answers, search.q))
    })
  }

  useEffect(() => {
    last = { key, state, inLibrary }
  }, [key, state, inLibrary])

  useEffect(() => {
    if (loaded.current === key) {
      // Restored; books may have been added since, on their pages.
      const refs = [
        ...state.books,
        ...(state.home?.rows ?? []).flatMap((r) => r.books),
      ].flatMap((b) => b.offers.map(({ source, id }) => ({ source, id })))
      void marketInLibrary({ data: refs }).then(remember, () => {})
      return
    }
    loaded.current = key
    generation.current++
    setState(EMPTY)
    browse(
      sources.filter((s) =>
        search.q
          ? s.searchable
          : !search.shelf || search.shelf.some((r) => r.source === s.id),
      ),
      {},
    )
    // `key` covers the search; sources only change on reload.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sources])

  return {
    ...state,
    inLibrary,
    loadMore() {
      setState((prev) => ({ ...prev, loading: true }))
      browse(
        sources.filter((s) => state.cursors[s.id]),
        state.cursors,
      )
    },
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
  const loading = market.loading

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

  const errors = market.errors

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
          <ListingView market={market} />
        ) : (
          <HomeView market={market} />
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

function HomeView({ market }: { market: Market }) {
  if (!market.home) return market.loading ? <Loading /> : null
  const { rows, shelves } = market.home
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
                <BookCard book={book} market={market} />
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

function ListingView({ market }: { market: Market }) {
  const search = Route.useSearch()
  const { books, shelves, loading } = market
  const title = search.q ?? market.title ?? 'Market'
  const hasMore = Object.keys(market.cursors).length > 0
  const empty = !books.length && !shelves.length

  return (
    <div className="grid gap-8">
      <nav className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
        <Link to="/market" className="shrink-0 hover:text-foreground">
          Market
        </Link>
        <ChevronRight className="size-4 shrink-0" />
        <h2 className="truncate font-sans font-medium text-foreground">
          {title}
        </h2>
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
              <BookCard book={book} market={market} />
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

// A book: the cover and title open its page; the button adds the best
// format from the first source that has one (the page lets you pick).
function BookCard({ book, market }: { book: MergedBook; market: Market }) {
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
  async function add() {
    setLocal({ status: 'adding' })
    let error = 'No EPUB available'
    for (const offer of book.offers) {
      try {
        const formatId = (
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
      <Link
        to="/market/book"
        search={{
          offers: book.offers.map(({ source, id }) => ({ source, id })),
        }}
        className="group block"
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
      </Link>
      <div className="mt-auto pt-3">
        <AddToLibraryButton
          state={state}
          onAdd={() => add()}
          size="sm"
          className="w-full"
        />
        {state.status === 'error' && (
          <p className="mt-1 text-xs text-destructive">{state.message}</p>
        )}
      </div>
    </div>
  )
}
