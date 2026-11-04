import { Link } from '@tanstack/react-router'
import { Check, Star } from 'lucide-react'

import { BookCover } from '#/components/book-cover'
import type { DiscoverBook, discoverWork } from '#/lib/discover-functions'
import { cn } from '#/lib/utils'

// A scrolling row (or a grid) of Hardcover books. A book in the library opens its page;
// otherwise admins search the Market for it and users open it on Hardcover.
export function DiscoverRow<T extends DiscoverBook>({
  title,
  books,
  admin,
  detail,
  grid,
}: {
  title: string
  books: T[]
  admin: boolean
  detail?: (book: T) => string
  grid?: boolean
}) {
  if (books.length === 0) return null
  return (
    <section className="min-w-0 animate-in duration-300 fade-in">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      <ul className={listClass(grid)}>
        {books.map((book) => (
          <li key={book.id} className={itemClass(grid)}>
            <DiscoverCard book={book} admin={admin} detail={detail} />
          </li>
        ))}
      </ul>
    </section>
  )
}

const listClass = (grid?: boolean) =>
  grid
    ? 'grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6'
    : '-mx-4 flex snap-x scroll-px-4 gap-4 overflow-x-auto px-4 pb-2'

const itemClass = (grid?: boolean) =>
  grid ? undefined : 'w-28 shrink-0 snap-start sm:w-32'

// Holds a row's space while Hardcover loads.
export function DiscoverRowSkeleton({ grid }: { grid?: boolean }) {
  return (
    <section className="min-w-0 animate-pulse" aria-hidden>
      <div className="mb-3 flex h-7 items-center">
        <div className="h-4 w-40 rounded bg-muted" />
      </div>
      <ul className={cn(listClass(grid), 'overflow-hidden')}>
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className={itemClass(grid)}>
            <div className="aspect-[2/3] w-full rounded-md bg-muted" />
            <div className="mt-2 h-5 py-1">
              <div className="h-full w-4/5 rounded bg-muted" />
            </div>
            <div className="mt-0.5 h-4 py-0.5">
              <div className="h-full w-1/2 rounded bg-muted" />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function DiscoverCard<T extends DiscoverBook>({
  book,
  admin,
  detail,
}: {
  book: T
  admin: boolean
  detail?: (book: T) => string
}) {
  const body = (
    <>
      <div className="relative">
        <BookCover
          {...book}
          className="transition-shadow group-hover:shadow-md"
        />
        {book.libraryId && (
          <span
            title="In your library"
            className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow ring-2 ring-background"
          >
            <Check className="size-3.5" strokeWidth={3} />
            <span className="sr-only">In your library</span>
          </span>
        )}
      </div>
      <p className="mt-2 line-clamp-2 text-sm leading-snug font-medium">
        {book.title}
      </p>
      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
        {detail ? detail(book) : book.authors.join(', ')}
      </p>
    </>
  )
  if (book.libraryId) {
    return (
      <Link
        to="/books/$bookId"
        params={{ bookId: book.libraryId }}
        className="group block"
      >
        {body}
      </Link>
    )
  }
  if (admin) {
    return (
      <Link
        to="/market"
        search={{ q: [book.title, book.authors[0]].filter(Boolean).join(' ') }}
        className="group block"
      >
        {body}
      </Link>
    )
  }
  return (
    <a href={book.url} target="_blank" rel="noreferrer" className="group block">
      {body}
    </a>
  )
}

type Discovery = Awaited<ReturnType<typeof discoverWork>>

// Under a book's title: its Hardcover rating, genres and moods. `discovery`
// is undefined while loading and null when Hardcover has nothing.
export function HardcoverTags({
  discovery,
  loading,
}: {
  discovery: Discovery | undefined
  loading: boolean
}) {
  if (loading) {
    return (
      <div className="mt-3 flex h-6 animate-pulse items-center gap-2">
        <div className="h-4 w-28 rounded bg-muted" />
        {[14, 16, 12, 18, 20].map((w) => (
          <div
            key={w}
            className="h-5 rounded-full bg-muted"
            style={{ width: `${w * 0.25}rem` }}
          />
        ))}
      </div>
    )
  }
  if (!discovery) return null
  return (
    <div className="mt-3 flex animate-in flex-wrap items-center gap-2 text-sm text-muted-foreground duration-300 fade-in">
      {discovery.rating != null && (
        <a
          href={discovery.url}
          target="_blank"
          rel="noreferrer"
          className="mr-1 flex items-center gap-1 hover:text-foreground"
        >
          <Star className="size-3.5 fill-current" />
          {discovery.rating.toFixed(1)} on Hardcover
        </a>
      )}
      {[...discovery.genres, ...discovery.moods].map((tag) => (
        <span key={tag} className="rounded-full border px-2 py-0.5 text-xs">
          {tag}
        </span>
      ))}
    </div>
  )
}

// At the bottom of a book page: more by the author and similar books.
export function HardcoverRows({
  discovery,
  loading,
  admin,
}: {
  discovery: Discovery | undefined
  loading: boolean
  admin: boolean
}) {
  if (loading) {
    return (
      <div className="mt-10 grid gap-8">
        <DiscoverRowSkeleton />
        <DiscoverRowSkeleton />
      </div>
    )
  }
  if (!discovery) return null
  return (
    <div className="mt-10 grid gap-8">
      {discovery.moreByAuthor && (
        <DiscoverRow
          title={`More by ${discovery.moreByAuthor.name}`}
          books={discovery.moreByAuthor.books}
          admin={admin}
        />
      )}
      <DiscoverRow
        title="Similar books"
        books={discovery.similar}
        admin={admin}
      />
    </div>
  )
}
