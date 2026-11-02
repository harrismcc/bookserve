// The contract for Market integrations. An integration fetches a store's
// catalog and maps it into these types; Bookserve owns everything else (the
// UI, caching, validation, downloading, EPUB checks and the library). See
// docs/market-integrations.md.

export const MARKET_API_VERSION = 1

export type BookSummary = {
  // Stable id within the integration; passed back to book() and download().
  id: string
  title: string
  authors: string[]
  coverUrl: string | null
  // When known in lists, these help the Market merge copies of a book from
  // different sources (it also merges by title and author).
  isbn?: string | null
  // ISO 639 code, e.g. `en`; copies in different languages never merge.
  language?: string | null
}

export type Format = {
  // Passed back to download().
  id: string
  // e.g. "EPUB3 (with images)".
  label: string
  // Bytes, when known.
  size: number | null
}

export type BookDetails = BookSummary & {
  // Plain text; blank lines separate paragraphs.
  description: string | null
  publisher: string | null
  // `YYYY`, `YYYY-MM` or `YYYY-MM-DD`.
  publishedDate: string | null
  subjects: string[]
  // Related shelves: more by the author, the same series or category...
  shelves: ShelfLink[]
  // EPUB downloads only, best first. Empty when the book has no EPUB.
  formats: Format[]
}

// A list to browse into: a category, author, subject, search refinement...
export type ShelfLink = {
  // Passed back to shelf().
  id: string
  title: string
  description: string | null
}

export type Listing = {
  title: string
  shelves: ShelfLink[]
  books: BookSummary[]
  // Pass back to get the next page; null on the last page.
  nextCursor: string | null
}

// What a home row is, so rows from different sources merge even when their
// titles differ. Rows without a kind merge by title.
export type RowKind = 'popular' | 'new'

// The landing page: rows of books, plus shelves to browse.
export type Home = {
  rows: Array<ShelfLink & { kind?: RowKind; books: BookSummary[] }>
  shelves: ShelfLink[]
}

export type SettingField = {
  key: string
  label: string
  type: 'text' | 'url' | 'password'
  required?: boolean
  placeholder?: string
}

export type IntegrationContext = {
  // The source's settings, as entered by an admin (keys from `settings`).
  settings: Record<string, string>
  // fetch for http(s) URLs, with a timeout and Bookserve's User-Agent. Throws
  // on network errors ("Timed out", "Could not connect") and on non-2xx
  // responses. The timeout covers reading the body; downloads get a longer one.
  fetch: (url: string, init?: FetchInit) => Promise<Response>
  // Memoizes `load` under `key` for `ttlMs`, per source. Failures aren't cached.
  cached: <T>(key: string, ttlMs: number, load: () => Promise<T>) => Promise<T>
}

export type FetchInit = {
  method?: string
  headers?: Record<string, string>
  body?: string | URLSearchParams
  timeoutMs?: number
  // Return non-2xx responses instead of throwing, so an integration can read
  // an error body. Callers must check `ok` themselves.
  allowErrorStatus?: boolean
}

export type MarketIntegration = {
  id: string
  name: string
  apiVersion: typeof MARKET_API_VERSION
  // Admin-entered settings per source (server URL, credentials...).
  settings: SettingField[]
  // Called when a source is added; throw to reject its settings.
  check?: (ctx: IntegrationContext) => Promise<void>
  home: (ctx: IntegrationContext) => Promise<Home>
  shelf: (
    ctx: IntegrationContext,
    shelfId: string,
    cursor: string | null,
  ) => Promise<Listing>
  // Optional: no search box without it.
  search?: (
    ctx: IntegrationContext,
    query: string,
    cursor: string | null,
  ) => Promise<Listing>
  book: (ctx: IntegrationContext, bookId: string) => Promise<BookDetails>
  // The EPUB file, usually `return ctx.fetch(url)`; Bookserve streams the
  // body into the library.
  download: (
    ctx: IntegrationContext,
    bookId: string,
    formatId: string,
  ) => Promise<Response>
}

// Helpers for integrations. Import everything from this module only.
export { htmlToText } from '#/lib/epub'
export {
  fillSearchTemplate,
  parseFeed,
  parseOpenSearch,
  resolveUrl,
} from '#/lib/market/opds'
export type { OpdsDownload, OpdsEntry, OpdsFeed } from '#/lib/market/opds'

export function defineIntegration(integration: MarketIntegration) {
  return integration
}
