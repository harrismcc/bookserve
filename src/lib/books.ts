import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'

import type { books } from '#/db/schema'

// Metadata fields a source (the book file, or a Phase 4 match) can provide.
export type BookMetadata = {
  title: string
  authors: string[]
  description: string | null
  language: string | null
  publisher: string | null
  publishedDate: string | null
  isbn: string | null
  series: string | null
  seriesIndex: number | null
}

// Overrides stored in books.matched; any field set here wins over the scanned one.
export type MatchedMetadata = Partial<BookMetadata> & { coverPath?: string }

type BookRow = typeof books.$inferSelect

export function sortKey(title: string) {
  return title
    .trim()
    .replace(/^(the|a|an)\s+/i, '')
    .toLowerCase()
}

// The metadata to show for a book: scanned columns overlaid with matched fields.
export function bookView(row: BookRow) {
  const m = row.matched ?? {}
  return {
    id: row.id,
    title: m.title ?? row.title,
    sortTitle: m.title ? sortKey(m.title) : row.sortTitle,
    authors: m.authors ?? row.authors,
    description: m.description ?? row.description,
    language: m.language ?? row.language,
    publisher: m.publisher ?? row.publisher,
    publishedDate: m.publishedDate ?? row.publishedDate,
    isbn: m.isbn ?? row.isbn,
    series: m.series ?? row.series,
    seriesIndex: m.seriesIndex ?? row.seriesIndex,
    coverPath: m.coverPath ?? row.coverPath,
    missing: row.missing,
    updatedAt: row.updatedAt,
  }
}

// Resolves a stored relative path under root, or null if it would escape it.
export function resolveInside(root: string, relative: string) {
  const resolved = path.resolve(root, relative)
  return resolved.startsWith(root + path.sep) ? resolved : null
}

// Streams a file from disk, or returns 404 if it isn't there.
export function fileResponse(file: string | null, headers: HeadersInit) {
  const stat = file ? fs.statSync(file, { throwIfNoEntry: false }) : undefined
  if (!file || !stat?.isFile()) {
    return new Response('Not found', { status: 404 })
  }
  const body = Readable.toWeb(fs.createReadStream(file)) as ReadableStream
  return new Response(body, {
    headers: { 'content-length': String(stat.size), ...headers },
  })
}
