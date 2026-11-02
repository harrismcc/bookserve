import { defineIntegration } from '#/lib/market/sdk'
import type { IntegrationContext, Listing } from '#/lib/market/sdk'
import {
  fillSearchTemplate,
  parseFeed,
  parseOpenSearch,
} from '#/lib/market/opds'
import type { OpdsEntry } from '#/lib/market/opds'

// Any OPDS 1.x catalog (Calibre, COPS, Kavita, Komga, Standard Ebooks...).
// Shelf ids and cursors are feed URLs; book ids are `<feed URL>#<entry id>`.
// Credentials are only sent to the catalog URL's origin.

const CACHE_MS = 5 * 60_000

function headers(ctx: IntegrationContext, url: string) {
  const { username, password } = ctx.settings
  const sameOrigin = new URL(url).origin === new URL(ctx.settings.url).origin
  return username && sameOrigin
    ? {
        authorization: `Basic ${Buffer.from(`${username}:${password ?? ''}`).toString('base64')}`,
      }
    : undefined
}

function feed(ctx: IntegrationContext, url: string) {
  const href = new URL(url, ctx.settings.url).href
  if (!/^https?:/.test(href)) throw new Error('Unknown shelf')
  return ctx.cached(href, CACHE_MS, async () => {
    const res = await ctx.fetch(href, { headers: headers(ctx, href) })
    return parseFeed(await res.text(), res.url || href)
  })
}

async function listing(ctx: IntegrationContext, url: string): Promise<Listing> {
  const f = await feed(ctx, url)
  const books = f.entries.filter((e) => e.downloads.length)
  return {
    title: f.title,
    shelves: f.entries
      .filter((e) => !e.downloads.length && e.href)
      .map((e) => ({ id: e.href!, title: e.title, description: e.summary })),
    books: books.map((e) => ({
      id: `${f.url}#${e.id}`,
      title: e.title,
      authors: e.authors,
      coverUrl: e.coverUrl,
      isbn: e.isbn,
    })),
    nextCursor: f.next,
  }
}

async function entry(
  ctx: IntegrationContext,
  bookId: string,
): Promise<OpdsEntry> {
  const hash = bookId.indexOf('#')
  if (hash < 0) throw new Error('Unknown book')
  const f = await feed(ctx, bookId.slice(0, hash))
  const found = f.entries.find((e) => e.id === bookId.slice(hash + 1))
  if (!found) throw new Error('Unknown book')
  return found
}

export const opds = defineIntegration({
  id: 'opds',
  name: 'OPDS catalog',
  apiVersion: 1,
  settings: [
    { key: 'url', label: 'Catalog URL', type: 'url', required: true },
    { key: 'username', label: 'Username', type: 'text' },
    { key: 'password', label: 'Password', type: 'password' },
  ],

  async check(ctx) {
    await feed(ctx, ctx.settings.url)
  },

  async home(ctx) {
    const root = await listing(ctx, ctx.settings.url)
    return {
      rows: root.books.length
        ? [
            {
              id: ctx.settings.url,
              title: root.title,
              description: null,
              books: root.books,
            },
          ]
        : [],
      shelves: root.shelves,
    }
  },

  shelf(ctx, shelfId, cursor) {
    return listing(ctx, cursor ?? shelfId)
  },

  async search(ctx, query, cursor) {
    if (cursor) return { ...(await listing(ctx, cursor)), title: query }
    const root = await feed(ctx, ctx.settings.url)
    if (!root.search) throw new Error('This catalog has no search')
    let template: string | null = root.search.href
    if (root.search.openSearch) {
      const res = await ctx.fetch(template, {
        headers: headers(ctx, template),
      })
      template = parseOpenSearch(await res.text())
    }
    const url = template && fillSearchTemplate(template, query, root.url)
    if (!url) throw new Error('This catalog has no search')
    return { ...(await listing(ctx, url)), title: query }
  },

  async book(ctx, bookId) {
    const e = await entry(ctx, bookId)
    return {
      id: bookId,
      title: e.title,
      authors: e.authors,
      coverUrl: e.coverUrl,
      description: e.summary,
      language: e.language,
      publisher: e.publisher,
      publishedDate: e.issued?.match(/^\d{4}(-\d{2}(-\d{2})?)?/)?.[0] ?? null,
      isbn: e.isbn,
      subjects: e.subjects,
      shelves: e.related.map((r) => ({
        id: r.href,
        title: r.title,
        description: null,
      })),
      formats: e.downloads.map((d) => ({
        id: d.href,
        label: d.title,
        size: d.size,
      })),
    }
  },

  async download(ctx, bookId, formatId) {
    const e = await entry(ctx, bookId)
    if (!e.downloads.some((d) => d.href === formatId)) {
      throw new Error('Unknown format')
    }
    return { url: formatId, headers: headers(ctx, formatId) }
  },
})
