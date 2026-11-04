import { Fragment, useState } from 'react'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'

import type { AddState } from '#/components/add-to-library-button'
import { AddToLibraryButton } from '#/components/add-to-library-button'
import { BookCover } from '#/components/book-cover'
import { HardcoverRows, HardcoverTags } from '#/components/discover-row'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { useDeferred } from '#/hooks/use-deferred'
import { discoverWork } from '#/lib/discover-functions'
import {
  listMarketSources,
  marketAdd,
  marketBook,
} from '#/lib/market-functions'
import type { SourceRef } from '#/lib/market/merge'
import { languageName } from '#/lib/utils'

// One Market book: `offers` lists every source that has it (one merged card),
// as `{ source, id }`. Shows the first source's details and every source's
// formats, plus what Hardcover knows about the book.
export const Route = createFileRoute('/_app/market_/book')({
  beforeLoad: ({ context }) => {
    if (context.user.role !== 'admin') throw redirect({ to: '/' })
  },
  validateSearch: (
    search: Record<string, unknown>,
  ): { offers: SourceRef[] } => ({
    offers: Array.isArray(search.offers)
      ? search.offers.flatMap((r: Record<string, unknown>) =>
          Number(r?.source) && typeof r?.id === 'string'
            ? [{ source: Number(r.source), id: r.id }]
            : [],
        )
      : [],
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps: { offers } }) => {
    if (!offers.length) throw redirect({ to: '/market' })
    const [sources, details] = await Promise.all([
      listMarketSources(),
      Promise.all(
        offers.map((offer) =>
          marketBook({
            data: { sourceId: offer.source, bookId: offer.id },
          }).then(
            (result) => ({ ...result, error: null }),
            (err) => ({ book: null, libraryBookId: null, error: message(err) }),
          ),
        ),
      ),
    ])
    return offers.map((offer, i) => ({
      ...offer,
      sourceName: sources.find((s) => s.id === offer.source)?.name ?? '',
      ...details[i],
    }))
  },
  head: ({ loaderData }) => {
    const title = loaderData?.find((o) => o.book)?.book?.title
    return { meta: title ? [{ title: `${title} · Bookserve` }] : [] }
  },
  pendingComponent: Pending,
  component: MarketBook,
})

const message = (err: unknown) =>
  err instanceof Error ? err.message : 'Request failed'

function formatSize(bytes: number | null) {
  if (!bytes) return null
  return bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1000))} KB`
}

const LAYOUT =
  'mx-auto grid max-w-6xl gap-8 px-4 py-8 sm:grid-cols-[14rem_1fr] md:grid-cols-[16rem_1fr]'

function Pending() {
  return (
    <main className={LAYOUT} aria-busy>
      <div className="mx-auto aspect-[2/3] w-full max-w-56 animate-pulse rounded-md bg-muted sm:max-w-none" />
      <div className="grid content-start gap-3 py-1">
        <div className="h-6 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-5 w-1/3 animate-pulse rounded bg-muted" />
      </div>
    </main>
  )
}

function MarketBook() {
  const offers = Route.useLoaderData()
  const { user, hardcover } = Route.useRouteContext()
  const details = offers.find((o) => o.book)?.book
  const libraryBookId = offers.map((o) => o.libraryBookId).find(Boolean)
  const [local, setLocal] = useState<AddState>({ status: 'idle' })
  const state: AddState = libraryBookId
    ? { status: 'added', bookId: libraryBookId }
    : local

  const formats = offers.flatMap((o) =>
    (o.book?.formats ?? []).map((f) => ({
      ...f,
      offer: o,
      key: `${o.source}:${o.id}|${f.id}`,
    })),
  )
  const multiSource = new Set(formats.map((f) => f.offer.source)).size > 1
  const [choice, setChoice] = useState(formats[0]?.key)
  const format = formats.find((f) => f.key === choice)
  const label = (f: (typeof formats)[number]) =>
    [
      multiSource && f.offer.sourceName,
      // Copies of one book (Z-Library lists many uploads) told apart.
      offers.length > 1 && f.offer.book?.publisher,
      offers.length > 1 && f.offer.book?.publishedDate,
      offers.length > 1 && f.offer.book?.rating && `★ ${f.offer.book.rating}`,
      f.label,
      formatSize(f.size),
    ]
      .filter(Boolean)
      .join(' · ')

  const discovery = useDeferred(
    offers.map((o) => `${o.source}:${o.id}`).join(' '),
    () =>
      details
        ? discoverWork({
            data: {
              title: details.title,
              authors: details.authors,
              isbn: details.isbn ?? null,
            },
          })
        : Promise.resolve(null),
  )
  const loading = hardcover && Boolean(details) && discovery === undefined
  const series = discovery?.series

  async function add() {
    if (!format) return
    setLocal({ status: 'adding' })
    try {
      const { bookId } = await marketAdd({
        data: {
          sourceId: format.offer.source,
          bookId: format.offer.id,
          formatId: format.id,
        },
      })
      setLocal({ status: 'added', bookId })
    } catch (err) {
      setLocal({ status: 'error', message: message(err) })
    }
  }

  const errors = offers.flatMap((o) =>
    o.error
      ? [
          <p key={`${o.source}:${o.id}`} className="text-sm text-destructive">
            Could not load {o.sourceName}: {o.error}
          </p>,
        ]
      : [],
  )
  if (!details) {
    return (
      <main className="mx-auto grid max-w-6xl gap-1 px-4 py-8">{errors}</main>
    )
  }

  const description = offers.map((o) => o.book?.description).find(Boolean)
  const shelves = offers.flatMap((o) =>
    (o.book?.shelves ?? []).map((s) => ({ ...s, source: o.source })),
  )
  const facts = [
    ['Publisher', details.publisher],
    ['Published', details.publishedDate],
    ['ISBN', details.isbn],
    ['Language', details.language && languageName(details.language)],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]))

  return (
    <main className={LAYOUT}>
      <BookCover
        title={details.title}
        authors={details.authors}
        coverUrl={offers.map((o) => o.book?.coverUrl).find(Boolean) ?? null}
        className="mx-auto max-w-56 sm:max-w-none"
      />
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold text-balance">{details.title}</h1>
        {details.authors.length > 0 && (
          <p className="mt-1 text-lg text-muted-foreground">
            {details.authors.map((author, i) => (
              <Fragment key={author}>
                {i > 0 && ', '}
                <Link
                  to="/authors/$name"
                  params={{ name: author }}
                  className="hover:text-foreground hover:underline"
                >
                  {author}
                </Link>
              </Fragment>
            ))}
          </p>
        )}
        {series && (
          <p className="mt-2 text-sm">
            <Link
              to="/series/$name"
              params={{ name: series.name }}
              search={{ author: details.authors[0] }}
              className="hover:underline"
            >
              {series.name}
              {series.position != null && ` #${series.position}`}
            </Link>
          </p>
        )}
        <HardcoverTags discovery={discovery} loading={loading} />

        <div className="mt-6 grid max-w-sm gap-3">
          {errors}
          {formats.length > 1 && state.status !== 'added' && (
            <Select value={choice} onValueChange={setChoice}>
              <SelectTrigger aria-label="Format" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {formats.map((f) => (
                  <SelectItem key={f.key} value={f.key}>
                    {label(f)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {formats.length === 0 && state.status !== 'added' ? (
            <p className="text-sm text-muted-foreground">No EPUB available</p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <AddToLibraryButton
                state={state}
                disabled={!format}
                onAdd={add}
              />
              {formats.length === 1 && state.status !== 'added' && (
                <span className="text-sm text-muted-foreground">
                  {label(formats[0])}
                </span>
              )}
            </div>
          )}
          {state.status === 'error' && (
            <p className="text-sm text-destructive">{state.message}</p>
          )}
        </div>

        {description && (
          <p className="mt-8 max-w-prose text-sm leading-relaxed whitespace-pre-line">
            {description}
          </p>
        )}
        {facts.length > 0 && (
          <dl className="mt-8 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            {facts.map(([name, value]) => (
              <div key={name} className="contents">
                <dt className="text-muted-foreground">{name}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {shelves.length > 0 && (
          <ul className="mt-8 flex flex-wrap gap-2">
            {shelves.map((shelf) => (
              <li key={`${shelf.source}:${shelf.id}`}>
                <Link
                  to="/market"
                  search={{ shelf: [{ source: shelf.source, id: shelf.id }] }}
                  className="block rounded-full border px-3 py-1 text-xs transition-colors hover:bg-accent"
                >
                  {shelf.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <HardcoverRows
          discovery={discovery}
          loading={loading}
          admin={user.role === 'admin'}
        />
      </div>
    </main>
  )
}
