import fsp from 'node:fs/promises'
import path from 'node:path'
import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'

import { db } from '#/db'
import { books } from '#/db/schema'
import type { MatchedMetadata } from '#/lib/books'
import { config } from '#/lib/config'
import { googleBooks } from '#/lib/metadata/google-books'
import { downloadCover } from '#/lib/metadata/http'
import { openLibrary } from '#/lib/metadata/open-library'
import type {
  MatchFields,
  MetadataProvider,
  MetadataQuery,
  ProviderId,
} from '#/lib/metadata/providers'
import { requireAdmin } from '#/lib/user-functions'

// Manual matching (admin only). Results are written to books.matched, never to
// the scanned columns or the book file; see bookView() in src/lib/books.ts.

const IMPLEMENTATIONS: Record<ProviderId, MetadataProvider> = {
  openlibrary: openLibrary,
  google: googleBooks,
}

function checkProvider(id: unknown): ProviderId {
  if (typeof id !== 'string' || !(id in IMPLEMENTATIONS)) {
    throw new Error('Unknown provider')
  }
  return id as ProviderId
}

const str = (value: unknown, max = 500) =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

// One provider per call, so the dialog shows each provider's results (or
// error) as soon as it answers.
export const searchMetadata = createServerFn({ method: 'POST' })
  .validator((data: { provider: string; query: MetadataQuery }) => {
    const query = {
      title: str(data.query.title),
      author: str(data.query.author),
      isbn: str(data.query.isbn).replace(/[^\dX]/gi, ''),
    }
    if (!query.title && !query.author && !query.isbn) {
      throw new Error('Enter a title, author or ISBN')
    }
    return { provider: checkProvider(data.provider), query }
  })
  .handler(async ({ data }) => {
    await requireAdmin()
    return IMPLEMENTATIONS[data.provider].search(data.query)
  })

export const getMatchDetails = createServerFn({ method: 'POST' })
  .validator((data: { provider: string; id: string }) => ({
    provider: checkProvider(data.provider),
    id: str(data.id, 100),
  }))
  .handler(async ({ data }) => {
    await requireAdmin()
    const details = IMPLEMENTATIONS[data.provider].details
    return details ? details(data.id) : {}
  })

// Keeps only well-formed, non-empty values; anything else is not applied.
function cleanFields(fields: Partial<Record<keyof MatchFields, unknown>>) {
  const out: Partial<MatchedMetadata> = {}
  for (const key of [
    'title',
    'publisher',
    'isbn',
    'language',
    'series',
  ] as const) {
    const value = str(fields[key])
    if (value) out[key] = value
  }
  const description = str(fields.description, 20_000)
  if (description) out.description = description
  if (Array.isArray(fields.authors)) {
    const authors = fields.authors.map((a) => str(a)).filter(Boolean)
    if (authors.length) out.authors = authors
  }
  const date = str(fields.publishedDate)
  if (/^\d{4}(-\d{2}(-\d{2})?)?$/.test(date)) out.publishedDate = date
  const { seriesIndex, pageCount } = fields
  if (typeof seriesIndex === 'number' && Number.isFinite(seriesIndex)) {
    out.seriesIndex = seriesIndex
  }
  if (Number.isInteger(pageCount) && (pageCount as number) > 0) {
    out.pageCount = pageCount as number
  }
  return out
}

const coversDir = () => path.join(config.dataDir, 'covers')

// Matched covers are <data>/covers/<id>-matched.<ext>, next to (never over)
// the scanned <id>.<ext>, which the scanner owns.
async function removeMatchedCovers(bookId: string, keep?: string) {
  const names = await fsp.readdir(coversDir()).catch(() => [])
  for (const name of names) {
    if (name.startsWith(`${bookId}-matched.`) && name !== keep) {
      await fsp.rm(path.join(coversDir(), name), { force: true })
    }
  }
}

function findBook(bookId: string) {
  const row = db
    .select({ id: books.id, matched: books.matched })
    .from(books)
    .where(eq(books.id, bookId))
    .get()
  if (!row) throw new Error('Book not found')
  return row
}

export const applyMatch = createServerFn({ method: 'POST' })
  .validator(
    (data: {
      bookId: string
      provider: string
      providerId: string
      fields: Partial<MatchFields>
      coverUrl: string | null
    }) => ({
      bookId: str(data.bookId, 100),
      provider: checkProvider(data.provider),
      providerId: str(data.providerId, 100),
      fields: cleanFields(data.fields ?? {}),
      coverUrl: data.coverUrl ? str(data.coverUrl, 2000) : null,
    }),
  )
  .handler(async ({ data }) => {
    await requireAdmin()
    const book = findBook(data.bookId)
    const matched: MatchedMetadata = {
      ...book.matched,
      ...data.fields,
      source: {
        provider: data.provider,
        id: data.providerId,
        matchedAt: new Date().toISOString(),
      },
    }
    if (data.coverUrl) {
      const cover = await downloadCover(data.coverUrl)
      const name = `${book.id}-matched.${cover.ext}`
      await fsp.mkdir(coversDir(), { recursive: true })
      await fsp.writeFile(path.join(coversDir(), name), cover.data)
      await removeMatchedCovers(book.id, name)
      matched.coverPath = `covers/${name}`
    }
    // Bumps updatedAt, which versions the cover URL.
    db.update(books).set({ matched }).where(eq(books.id, book.id)).run()
  })

export const revertMatch = createServerFn({ method: 'POST' })
  .validator((bookId: string) => str(bookId, 100))
  .handler(async ({ data: bookId }) => {
    await requireAdmin()
    const book = findBook(bookId)
    db.update(books).set({ matched: null }).where(eq(books.id, book.id)).run()
    await removeMatchedCovers(book.id)
  })
