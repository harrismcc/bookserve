import { createFileRoute } from '@tanstack/react-router'
import { ExternalLink } from 'lucide-react'

import { BookGrid } from '#/components/book-grid'
import { DiscoverRow, DiscoverRowSkeleton } from '#/components/discover-row'
import { useDeferred } from '#/hooks/use-deferred'
import { discoverSeries, getSeriesBooks } from '#/lib/discover-functions'

// `author` tells Hardcover which of several same-named series this is.
export const Route = createFileRoute('/_app/series/$name')({
  validateSearch: (search: Record<string, unknown>): { author?: string } => ({
    author: typeof search.author === 'string' ? search.author : undefined,
  }),
  loader: ({ params }) => getSeriesBooks({ data: params.name }),
  head: ({ params }) => ({ meta: [{ title: `${params.name} · Bookserve` }] }),
  component: Series,
})

const position = (n: number | null) => (n == null ? '' : `#${n}`)

function Series() {
  const books = Route.useLoaderData()
  const { name } = Route.useParams()
  const { author: authorParam } = Route.useSearch()
  const { user, hardcover } = Route.useRouteContext()
  const author = authorParam ?? books[0]?.authors[0] ?? null
  const series = useDeferred(`${name}|${author}`, () =>
    discoverSeries({ data: { series: name, author } }),
  )
  const loading = hardcover && series === undefined
  const missing = series?.books.filter((b) => !b.libraryId) ?? []
  const shown = [
    ...books,
    ...(series?.library ?? []).filter((b) => !books.some((l) => l.id === b.id)),
  ].sort((a, b) => (a.seriesIndex ?? Infinity) - (b.seriesIndex ?? Infinity))

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-semibold">{name}</h1>
      <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-muted-foreground">
        {author && <span>{author}</span>}
        {series && (
          <a
            href={series.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 hover:text-foreground"
          >
            Hardcover
            <ExternalLink className="size-3" />
          </a>
        )}
      </p>
      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">In your library</h2>
        {shown.length ? (
          <BookGrid
            books={shown}
            detail={(b) => position(b.seriesIndex) || b.authors.join(', ')}
          />
        ) : (
          <p className="text-sm text-muted-foreground">No books</p>
        )}
      </section>
      <div className="mt-10">
        {loading && <DiscoverRowSkeleton grid />}
        <DiscoverRow
          title="Not in your library"
          books={missing}
          admin={user.role === 'admin'}
          detail={(b) => position(b.position) || b.authors.join(', ')}
          grid
        />
      </div>
    </main>
  )
}
