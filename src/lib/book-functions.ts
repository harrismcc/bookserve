import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq } from 'drizzle-orm'

import { db } from '#/db'
import { bookFiles, books, readingProgress } from '#/db/schema'
import { bookCard, bookView, coverUrl } from '#/lib/books'
import { deleteBook, scanLibrary } from '#/lib/scanner'
import { requireAdmin, requireSession } from '#/lib/user-functions'

export const listBooks = createServerFn({ method: 'GET' }).handler(async () => {
  await requireSession()
  return db
    .select()
    .from(books)
    .all()
    .map(bookView)
    .sort((a, b) => a.sortTitle.localeCompare(b.sortTitle))
    .map(bookCard)
})

export const getBook = createServerFn({ method: 'GET' })
  .validator((bookId: string) => bookId)
  .handler(async ({ data: bookId }) => {
    const session = await requireSession()
    const row = db.select().from(books).where(eq(books.id, bookId)).get()
    if (!row) return null
    const { coverPath, updatedAt, sortTitle, ...book } = bookView(row)
    // The user's latest position from a KOSync reader, matched by file hash.
    const progress = db
      .select({
        percentage: readingProgress.percentage,
        device: readingProgress.device,
        updatedAt: readingProgress.updatedAt,
      })
      .from(readingProgress)
      .innerJoin(
        bookFiles,
        eq(bookFiles.koreaderHash, readingProgress.document),
      )
      .where(
        and(
          eq(bookFiles.bookId, bookId),
          eq(readingProgress.userId, session.user.id),
        ),
      )
      .orderBy(desc(readingProgress.updatedAt))
      .get()
    return {
      ...book,
      coverUrl: coverUrl({ ...book, coverPath, updatedAt }),
      matched: row.matched != null,
      // Changes on every match, revert and rescan.
      version: updatedAt.getTime(),
      progress: progress
        ? { ...progress, updatedAt: progress.updatedAt.toISOString() }
        : null,
    }
  })

export const scanLibraryNow = createServerFn({ method: 'POST' }).handler(
  async () => {
    await requireAdmin()
    return scanLibrary()
  },
)

// Removes the book and deletes its file from the library.
export const removeBook = createServerFn({ method: 'POST' })
  .validator((bookId: string) => bookId)
  .handler(async ({ data: bookId }) => {
    await requireAdmin()
    await deleteBook(bookId)
  })
