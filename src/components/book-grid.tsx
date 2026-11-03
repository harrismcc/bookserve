import { Link } from '@tanstack/react-router'

import { BookCover } from '#/components/book-cover'
import { cn } from '#/lib/utils'

type Card = {
  id: string
  title: string
  authors: string[]
  coverUrl: string | null
  missing: boolean
}

// Library books as a grid of covers. `detail` replaces the authors line.
export function BookGrid<T extends Card>({
  books,
  detail = (book) => book.authors.join(', '),
}: {
  books: T[]
  detail?: (book: T) => string
}) {
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {books.map((book) => (
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
              {detail(book)}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  )
}
