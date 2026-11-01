import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { eq } from 'drizzle-orm'

import { db } from '#/db'
import { books } from '#/db/schema'
import { auth } from '#/lib/auth'
import { bookView } from '#/lib/books'
import { scanLibrary } from '#/lib/scanner'
import { requireAdmin } from '#/lib/user-functions'

async function requireSession() {
  const session = await auth.api.getSession({ headers: getRequestHeaders() })
  if (!session) throw new Error('Unauthorized')
  return session
}

// Cover URLs carry the row's update time, so the route can cache them for good.
const coverUrl = (book: {
  id: string
  coverPath: string | null
  updatedAt: Date
}) =>
  book.coverPath
    ? `/api/books/${book.id}/cover?v=${book.updatedAt.getTime()}`
    : null

export const listBooks = createServerFn({ method: 'GET' }).handler(async () => {
  await requireSession()
  return db
    .select()
    .from(books)
    .all()
    .map(bookView)
    .sort((a, b) => a.sortTitle.localeCompare(b.sortTitle))
    .map((book) => ({
      id: book.id,
      title: book.title,
      authors: book.authors,
      coverUrl: coverUrl(book),
      missing: book.missing,
    }))
})

export const getBook = createServerFn({ method: 'GET' })
  .validator((bookId: string) => bookId)
  .handler(async ({ data: bookId }) => {
    await requireSession()
    const row = db.select().from(books).where(eq(books.id, bookId)).get()
    if (!row) return null
    const { coverPath, updatedAt, sortTitle, ...book } = bookView(row)
    return { ...book, coverUrl: coverUrl({ ...book, coverPath, updatedAt }) }
  })

export const scanLibraryNow = createServerFn({ method: 'POST' }).handler(
  async () => {
    await requireAdmin()
    return scanLibrary()
  },
)
