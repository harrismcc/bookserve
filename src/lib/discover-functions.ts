import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'

import { db } from '#/db'
import { books } from '#/db/schema'
import { bookCard, bookView } from '#/lib/books'
import { bookKeys } from '#/lib/market/merge'
import {
  findHardcoverBook,
  hardcoverAuthor,
  hardcoverBookDetails,
  hardcoverEnabled,
  hardcoverSeries,
} from '#/lib/metadata/hardcover'
import type { HardcoverBook } from '#/lib/metadata/hardcover'
import { requireSession } from '#/lib/user-functions'
import { foldName } from '#/lib/utils'

// Author and series pages, and the Hardcover rows on book pages. The library
// half works offline; Hardcover adds what isn't in the library, and the
// `discover*` functions return null without a token or when it fails.

const name = (value: unknown) =>
  typeof value === 'string' ? value.trim().slice(0, 500) : ''

const libraryViews = () => db.select().from(books).all().map(bookView)

const bySortTitle = (a: { sortTitle: string }, b: { sortTitle: string }) =>
  a.sortTitle.localeCompare(b.sortTitle)

export const getAuthorBooks = createServerFn({ method: 'GET' })
  .validator(name)
  .handler(async ({ data: author }) => {
    await requireSession()
    const wanted = foldName(author)
    return libraryViews()
      .filter((b) => b.authors.some((a) => foldName(a) === wanted))
      .sort(bySortTitle)
      .map(bookCard)
  })

export const getSeriesBooks = createServerFn({ method: 'GET' })
  .validator(name)
  .handler(async ({ data: series }) => {
    await requireSession()
    const wanted = foldName(series)
    return libraryViews()
      .filter((b) => b.series && foldName(b.series) === wanted)
      .sort(
        (a, b) =>
          (a.seriesIndex ?? Infinity) - (b.seriesIndex ?? Infinity) ||
          bySortTitle(a, b),
      )
      .map((b) => ({ ...bookCard(b), seriesIndex: b.seriesIndex }))
  })

// A Hardcover book, and the library book that is the same work, if any.
export type DiscoverBook = HardcoverBook & { libraryId: string | null }

function libraryIndex() {
  const index = new Map<string, string>()
  for (const book of libraryViews()) {
    for (const key of bookKeys(book)) {
      if (!index.has(key)) index.set(key, book.id)
    }
  }
  return (book: HardcoverBook): DiscoverBook => ({
    ...book,
    libraryId:
      bookKeys({ ...book, isbn: null })
        .map((k) => index.get(k))
        .find(Boolean) ?? null,
  })
}

// Discovery fails softly: the page just leaves the Hardcover parts out.
async function soft<T>(what: string, load: () => Promise<T>) {
  if (!hardcoverEnabled()) return null
  try {
    return await load()
  } catch (err) {
    console.warn(`Hardcover ${what}:`, err instanceof Error ? err.message : err)
    return null
  }
}

export const discoverBook = createServerFn({ method: 'GET' })
  .validator((bookId: string) => name(bookId))
  .handler(async ({ data: bookId }) => {
    await requireSession()
    return soft('book', async () => {
      const row = db.select().from(books).where(eq(books.id, bookId)).get()
      if (!row) return null
      const book = bookView(row)
      const source = row.matched?.source
      const id = await findHardcoverBook(
        book,
        source?.provider === 'hardcover' ? source.id : undefined,
      )
      const details = id ? await hardcoverBookDetails(id) : null
      if (!id || !details) return null
      // Hardcover's spelling of the name, so the author search finds it.
      const authorName = details.author ?? book.authors[0]
      const author = authorName
        ? await hardcoverAuthor(authorName).catch(() => null)
        : null
      const link = libraryIndex()
      return {
        ...details,
        similar: details.similar.map(link),
        // Other books by the author, in the library or not, most read first.
        moreByAuthor: author && {
          name: author.name,
          books: author.books
            .filter((b) => b.id !== id)
            .map(link)
            .filter((b) => b.libraryId !== bookId)
            .slice(0, 12),
        },
      }
    })
  })

export const discoverAuthor = createServerFn({ method: 'GET' })
  .validator(name)
  .handler(async ({ data: authorName }) => {
    await requireSession()
    return soft('author', async () => {
      const author = await hardcoverAuthor(authorName)
      if (!author) return null
      const link = libraryIndex()
      return { ...author, books: author.books.map(link) }
    })
  })

export const discoverSeries = createServerFn({ method: 'GET' })
  .validator((data: { series: string; author: string | null }) => ({
    series: name(data.series),
    author: name(data.author) || null,
  }))
  .handler(async ({ data }) => {
    await requireSession()
    return soft('series', async () => {
      const series = await hardcoverSeries(data.series, data.author)
      if (!series) return null
      const views = libraryViews()
      const link = libraryIndex()
      // A library book with this series' name and the same number is that
      // book, even under another title ("The Sign of the Four").
      const wanted = foldName(data.series)
      const byPosition = new Map(
        views
          .filter((b) => b.series && foldName(b.series) === wanted)
          .map((b) => [b.seriesIndex, b.id]),
      )
      const linked = series.books.map((b) => {
        const book = link(b)
        return {
          ...book,
          libraryId: book.libraryId ?? byPosition.get(b.position) ?? null,
          position: b.position,
        }
      })
      // Library books Hardcover puts in the series, for those whose file
      // doesn't name it.
      const ids = new Set(linked.flatMap((b) => b.libraryId ?? []))
      const library = views
        .filter((b) => ids.has(b.id))
        .map((b) => ({
          ...bookCard(b),
          seriesIndex:
            linked.find((l) => l.libraryId === b.id)?.position ?? null,
        }))
      return { ...series, books: linked, library }
    })
  })
