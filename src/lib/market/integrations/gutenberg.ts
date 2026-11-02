import { defineIntegration, parseFeed } from '#/lib/market/sdk'
import type {
  BookSummary,
  IntegrationContext,
  Listing,
  OpdsEntry,
  ShelfLink,
} from '#/lib/market/sdk'

// Project Gutenberg, through its OPDS catalog, with its quirks smoothed over:
// lists link to a feed per book, so covers come from Gutenberg's predictable
// cover URLs; a book's feed has one entry per build (with and without images),
// merged into one book; descriptions come from the "Summary:" field.

const BASE = 'https://www.gutenberg.org'
const CACHE_MS = 10 * 60_000

const ROWS = [
  {
    id: 'popular',
    kind: 'popular' as const,
    title: 'Popular',
    path: '/ebooks/search.opds/?sort_order=downloads',
  },
  {
    id: 'latest',
    kind: 'new' as const,
    title: 'Latest',
    path: '/ebooks/search.opds/?sort_order=release_date',
  },
]

// Gutenberg's "Category:" bookshelves.
const CATEGORIES: Array<[number, string]> = [
  [645, 'Novels'],
  [649, 'Classics of Literature'],
  [644, 'Adventure'],
  [638, 'Science Fiction & Fantasy'],
  [640, 'Crime, Thrillers & Mystery'],
  [639, 'Romance'],
  [635, 'Historical Novels'],
  [634, 'Short Stories'],
  [637, 'Poetry'],
  [642, 'Plays, Films & Dramas'],
  [641, 'Humour'],
  [636, 'Children & Young Adult'],
  [646, 'Mythology & Folklore'],
  [643, 'Biographies'],
  [647, 'Essays, Letters & Speeches'],
  [648, 'Travel Writing'],
]

// Labels for Gutenberg's EPUB builds (keyed by the download URL's suffix).
const FORMAT_LABELS: Record<string, string> = {
  'epub3.images': 'EPUB 3',
  'epub.images': 'EPUB 2 (older e-readers)',
  'epub.noimages': 'EPUB 2 without images',
}

const formatRank = (id: string) => {
  const rank = Object.keys(FORMAT_LABELS).indexOf(id)
  return rank < 0 ? 99 : rank
}

const coverUrl = (id: string) =>
  `${BASE}/cache/epub/${id}/pg${id}.cover.medium.jpg`

const displayName = (name: string) =>
  name.replace(/^([^,]+), ([^,]+)$/, '$2 $1')

// "Books in Category: Romance", "By Austen, Jane…" → "Romance", "Jane Austen".
function shelfTitle(title: string) {
  const t = title
    .replace(/…$/, '')
    .replace(/^Books /, '')
    .replace(/^(in|on) (Category: )?/i, '')
  return /^by /i.test(t) ? displayName(t.slice(3)) : t
}

// A catalog path on gutenberg.org from a shelf id, cursor or href. Author and
// subject searches are blocked for bots, so they aren't shelves.
function catalogPath(value: string) {
  const url = new URL(value, BASE)
  if (
    url.origin !== BASE ||
    !url.pathname.startsWith('/ebooks/') ||
    /^\/ebooks\/\w+\/search/.test(url.pathname)
  ) {
    return null
  }
  return url.pathname + url.search
}

function feed(ctx: IntegrationContext, path: string) {
  return ctx.cached(path, CACHE_MS, async () => {
    const res = await ctx.fetch(BASE + path)
    return parseFeed(await res.text(), BASE + path)
  })
}

async function listing(
  ctx: IntegrationContext,
  path: string | null,
  title?: string,
): Promise<Listing> {
  if (!path) throw new Error('Unknown shelf')
  const f = await feed(ctx, path)
  const books: BookSummary[] = []
  const shelves: ShelfLink[] = []
  for (const entry of f.entries) {
    const id = entry.href?.match(
      /^https:\/\/www\.gutenberg\.org\/ebooks\/(\d+)\.opds$/,
    )?.[1]
    const shelf = entry.href ? catalogPath(entry.href) : null
    if (id) {
      // In lists, the content is the author, or a download count without one.
      const author = entry.summary && !/^\d+ downloads$/.test(entry.summary)
      books.push({
        id,
        title: entry.title,
        authors: author ? [entry.summary!] : [],
        coverUrl: coverUrl(id),
      })
    } else if (shelf) {
      shelves.push({
        id: shelf,
        title: shelfTitle(entry.title),
        description: entry.summary,
      })
    }
  }
  return {
    title: title ?? shelfTitle(f.title),
    shelves,
    books,
    nextCursor: f.next ? catalogPath(f.next) : null,
  }
}

// The builds in a book's feed, largest first (the one with images).
async function builds(ctx: IntegrationContext, id: string) {
  if (!/^\d+$/.test(id)) throw new Error('Unknown book')
  const { entries } = await feed(ctx, `/ebooks/${id}.opds`)
  if (!entries.length) throw new Error('Unknown book')
  const largest = (e: OpdsEntry) =>
    Math.max(0, ...e.downloads.map((d) => d.size ?? 0))
  return [...entries].sort((a, b) => largest(b) - largest(a))
}

// "epub3.images" from https://www.gutenberg.org/ebooks/1342.epub3.images.
function formatId(id: string, href: string) {
  const prefix = `${BASE}/ebooks/${id}.`
  return href.startsWith(prefix) ? href.slice(prefix.length) : null
}

export const gutenberg = defineIntegration({
  id: 'gutenberg',
  name: 'Project Gutenberg',
  apiVersion: 1,
  settings: [],

  async home(ctx) {
    const rows = await Promise.all(
      ROWS.map(async (row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        description: null,
        books: (await listing(ctx, row.path)).books,
      })),
    )
    return {
      rows,
      shelves: CATEGORIES.map(([id, title]) => ({
        id: `/ebooks/bookshelf/${id}.opds?sort_order=downloads`,
        title,
        description: null,
      })),
    }
  },

  shelf(ctx, shelfId, cursor) {
    const row = ROWS.find((r) => r.id === shelfId)
    const category = CATEGORIES.find(
      ([id]) => shelfId === `/ebooks/bookshelf/${id}.opds?sort_order=downloads`,
    )
    return listing(
      ctx,
      catalogPath(cursor ?? row?.path ?? shelfId),
      row?.title ?? category?.[1],
    )
  },

  async search(ctx, query, cursor) {
    const result = await listing(
      ctx,
      cursor
        ? catalogPath(cursor)
        : `/ebooks/search.opds/?query=${encodeURIComponent(query)}`,
    )
    return { ...result, title: query }
  },

  async book(ctx, id) {
    const entries = await builds(ctx, id)
    const main = entries[0]
    const summary = main.summary?.match(
      /(?:^|\n)Summary:\s*([\s\S]*?)(?:\n\s*\n|$)/,
    )?.[1]
    const formats = entries
      .flatMap((e) => e.downloads)
      .flatMap((d) => {
        const fid = formatId(id, d.href)
        return fid
          ? [{ id: fid, label: FORMAT_LABELS[fid] ?? d.title, size: d.size }]
          : []
      })
      .sort((a, b) => formatRank(a.id) - formatRank(b.id))
    return {
      id,
      title: main.title,
      authors: main.authors,
      coverUrl: main.coverUrl ?? coverUrl(id),
      description: summary?.trim() || null,
      language: main.language,
      // Gutenberg's dates are its own release dates, not publication dates.
      publisher: null,
      publishedDate: null,
      isbn: null,
      subjects: main.subjects,
      shelves: main.related.flatMap((r) => {
        const shelf = catalogPath(r.href)
        return shelf
          ? [{ id: shelf, title: shelfTitle(r.title), description: null }]
          : []
      }),
      formats,
    }
  },

  async download(ctx, id, fid) {
    const entries = await builds(ctx, id)
    const known = entries.some((e) =>
      e.downloads.some((d) => formatId(id, d.href) === fid),
    )
    if (!known) throw new Error('Unknown format')
    return ctx.fetch(`${BASE}/ebooks/${id}.${fid}`)
  },
})
