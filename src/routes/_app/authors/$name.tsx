import { createFileRoute } from '@tanstack/react-router'
import { ExternalLink } from 'lucide-react'

import { BookGrid } from '#/components/book-grid'
import { DiscoverRow, DiscoverRowSkeleton } from '#/components/discover-row'
import { Skeleton } from '#/components/ui/skeleton'
import { useDeferred } from '#/hooks/use-deferred'
import { discoverAuthor, getAuthorBooks } from '#/lib/discover-functions'

export const Route = createFileRoute('/_app/authors/$name')({
  loader: ({ params }) => getAuthorBooks({ data: params.name }),
  head: ({ params }) => ({ meta: [{ title: `${params.name} · Bookserve` }] }),
  component: Author,
})

function Author() {
  const books = Route.useLoaderData()
  const { name } = Route.useParams()
  const { user, hardcover } = Route.useRouteContext()
  const author = useDeferred(name, () => discoverAuthor({ data: name }))
  const loading = hardcover && author === undefined
  const missing = author?.books.filter((b) => !b.libraryId) ?? []
  const years =
    author?.born && `${author.born}–${author.died ?? ''}`.replace(/–$/, '')

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-semibold">{name}</h1>
      {loading && (
        <div className="mt-2 max-w-prose" aria-hidden>
          <div className="h-5 py-1">
            <Skeleton className="h-full w-32" />
          </div>
          <div className="mt-3 grid gap-2 py-0.5">
            {['100%', '95%', '98%', '60%'].map((width, i) => (
              <Skeleton key={i} className="h-4" style={{ width }} />
            ))}
          </div>
        </div>
      )}
      {author && (
        <div className="mt-2 max-w-prose animate-in text-sm text-muted-foreground duration-300 fade-in">
          <p className="flex flex-wrap gap-x-3">
            {years && <span>{years}</span>}
            <a
              href={author.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 hover:text-foreground"
            >
              Hardcover
              <ExternalLink className="size-3" />
            </a>
          </p>
          {author.bio && (
            <p className="mt-3 leading-relaxed whitespace-pre-line text-foreground">
              {author.bio}
            </p>
          )}
        </div>
      )}
      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">In your library</h2>
        {books.length ? (
          <BookGrid books={books} />
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
          grid
        />
      </div>
    </main>
  )
}
