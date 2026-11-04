import { HttpError, request } from '#/lib/metadata/http'
import { gutenberg } from '#/lib/market/integrations/gutenberg'
import { opds } from '#/lib/market/integrations/opds'
import { zlibrary } from '#/lib/market/integrations/z-library'
import { MARKET_API_VERSION } from '#/lib/market/sdk'
import type {
  BookDetails,
  BookSummary,
  Home,
  IntegrationContext,
  Listing,
  MarketIntegration,
  RowKind,
  ShelfLink,
} from '#/lib/market/sdk'

// Runs integrations for the Market: builds their context, and checks and
// trims everything they return before it reaches the UI or the library.

// Built-in integrations. Add new ones here.
export const INTEGRATIONS: Record<string, MarketIntegration> =
  Object.fromEntries(
    [gutenberg, opds, zlibrary]
      .filter((i) => i.apiVersion === MARKET_API_VERSION)
      .map((i) => [i.id, i]),
  )

export function getIntegration(id: string) {
  const integration = INTEGRATIONS[id]
  if (!integration) throw new Error(`Unknown integration: ${id}`)
  return integration
}

const TIMEOUT_MS = 15_000
export const DOWNLOAD_TIMEOUT_MS = 10 * 60_000
const MAX_CACHE_ENTRIES = 200

// Per source; module state, so it lasts as long as the process.
const caches = new Map<
  string,
  Map<string, { at: number; value: Promise<unknown> }>
>()

// `timeoutMs` is the default for ctx.fetch: DOWNLOAD_TIMEOUT_MS for download().
export function createContext(
  cacheKey: string,
  settings: Record<string, string>,
  timeoutMs = TIMEOUT_MS,
): IntegrationContext {
  let cache = caches.get(cacheKey)
  if (!cache) caches.set(cacheKey, (cache = new Map()))
  const entries = cache
  return {
    settings,
    async fetch(url, init) {
      if (!/^https?:\/\//i.test(url)) throw new Error('Invalid URL')
      const res = await request(url, init?.timeoutMs ?? timeoutMs, init)
      if (!res.ok && !init?.allowErrorStatus) throw new HttpError(res.status)
      return res
    },
    cached<T>(key: string, ttlMs: number, load: () => Promise<T>) {
      const hit = entries.get(key)
      if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>
      const value = load()
      entries.set(key, { at: Date.now(), value })
      value.catch(() => entries.delete(key))
      // Drop the oldest entries; Maps iterate in insertion order.
      for (const k of entries.keys()) {
        if (entries.size <= MAX_CACHE_ENTRIES) break
        entries.delete(k)
      }
      return value
    },
  }
}

export function clearCache(cacheKey: string) {
  caches.delete(cacheKey)
}

const ROW_KINDS: RowKind[] = ['popular', 'new']

const str = (value: unknown, max = 500) =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

const strs = (value: unknown, max = 50) =>
  Array.isArray(value)
    ? value
        .map((v) => str(v))
        .filter(Boolean)
        .slice(0, max)
    : []

const httpUrl = (value: unknown) => {
  const url = str(value, 2000)
  return /^https?:\/\//i.test(url) ? url : null
}

const size = (value: unknown) =>
  Number.isSafeInteger(value) && (value as number) > 0
    ? (value as number)
    : null

function summary(book: BookSummary): BookSummary {
  return {
    id: str(book.id, 2000),
    title: str(book.title) || 'Untitled',
    authors: strs(book.authors),
    coverUrl: httpUrl(book.coverUrl),
    isbn: str(book.isbn, 20).replace(/[^\dX]/gi, '') || null,
    language: str(book.language, 20) || null,
    rating:
      typeof book.rating === 'number' && book.rating >= 0 && book.rating <= 5
        ? book.rating
        : null,
  }
}

function shelf(link: ShelfLink): ShelfLink {
  return {
    id: str(link.id, 2000),
    title: str(link.title) || 'Untitled',
    description: str(link.description, 1000) || null,
  }
}

const books = (list: BookSummary[]) =>
  (Array.isArray(list) ? list : []).map(summary).filter((b) => b.id)
const shelves = (list: ShelfLink[]) =>
  (Array.isArray(list) ? list : []).map(shelf).filter((s) => s.id)

export function cleanHome(home: Home): Home {
  return {
    rows: (Array.isArray(home.rows) ? home.rows : [])
      .map((row) => ({
        ...shelf(row),
        kind: ROW_KINDS.includes(row.kind!) ? row.kind : undefined,
        books: books(row.books),
      }))
      .filter((row) => row.id && row.books.length),
    shelves: shelves(home.shelves),
  }
}

export function cleanListing(listing: Listing): Listing {
  return {
    title: str(listing.title) || 'Untitled',
    shelves: shelves(listing.shelves),
    books: books(listing.books),
    nextCursor: str(listing.nextCursor, 2000) || null,
  }
}

export function cleanDetails(book: BookDetails): BookDetails {
  const date = str(book.publishedDate)
  return {
    ...summary(book),
    description: str(book.description, 20_000) || null,
    publisher: str(book.publisher) || null,
    publishedDate: /^\d{4}(-\d{2}(-\d{2})?)?$/.test(date) ? date : null,
    subjects: strs(book.subjects),
    shelves: shelves(book.shelves),
    formats: (Array.isArray(book.formats) ? book.formats : [])
      .map((f) => ({
        id: str(f.id, 2000),
        label: str(f.label) || 'EPUB',
        size: size(f.size),
      }))
      .filter((f) => f.id),
  }
}
