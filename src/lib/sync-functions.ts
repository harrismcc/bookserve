import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { and, desc, eq } from 'drizzle-orm'

import { db } from '#/db'
import { bookFiles, books, readingProgress } from '#/db/schema'
import { bookView } from '#/lib/books'
import { publicOrigin } from '#/lib/opds-feed'
import { getSetting, setSetting } from '#/lib/settings'
import { requireAdmin, requireSession } from '#/lib/user-functions'

// The KOReader sync page: whether sync is on, the server URL, and every
// position the user's readers have pushed, newest first. A position links to a
// library book through the file's KOReader hash; others have no title.
export const getSyncSettings = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { user } = await requireSession()
    const rows = db
      .select({
        document: readingProgress.document,
        percentage: readingProgress.percentage,
        device: readingProgress.device,
        updatedAt: readingProgress.updatedAt,
        book: books,
      })
      .from(readingProgress)
      .leftJoin(bookFiles, eq(bookFiles.koreaderHash, readingProgress.document))
      .leftJoin(books, eq(books.id, bookFiles.bookId))
      .where(eq(readingProgress.userId, user.id))
      .orderBy(desc(readingProgress.updatedAt))
      .all()
    // Identical files in the library share a hash; list each position once.
    const seen = new Set<string>()
    const progress = rows
      .filter((row) => !seen.has(row.document) && seen.add(row.document))
      .map(({ book, updatedAt, ...row }) => ({
        ...row,
        updatedAt: updatedAt.toISOString(),
        book: book && { id: book.id, title: bookView(book).title },
      }))
    return {
      enabled: getSetting('kosyncEnabled'),
      url: `${publicOrigin(getRequest())}/kosync`,
      progress,
    }
  },
)

export const setKosyncEnabled = createServerFn({ method: 'POST' })
  .validator((enabled: boolean) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid value')
    return enabled
  })
  .handler(async ({ data }) => {
    await requireAdmin()
    setSetting('kosyncEnabled', data)
  })

// Forgets the server's position for a document. Readers keep their own, and
// the next push from any of them stores a new one.
export const deleteProgress = createServerFn({ method: 'POST' })
  .validator((data: { document: string }) => data)
  .handler(async ({ data }) => {
    const { user } = await requireSession()
    db.delete(readingProgress)
      .where(
        and(
          eq(readingProgress.userId, user.id),
          eq(readingProgress.document, data.document),
        ),
      )
      .run()
  })
