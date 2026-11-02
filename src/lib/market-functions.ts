import fsp from 'node:fs/promises'
import path from 'node:path'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq, inArray } from 'drizzle-orm'

import { db } from '#/db'
import { bookSources, books, marketSources } from '#/db/schema'
import { bookView } from '#/lib/books'
import type { MatchedMetadata } from '#/lib/books'
import { config } from '#/lib/config'
import {
  DOWNLOAD_TIMEOUT_MS,
  INTEGRATIONS,
  cleanDetails,
  cleanHome,
  cleanListing,
  clearCache,
  createContext,
  getIntegration,
} from '#/lib/market/host'
import { downloadCover } from '#/lib/metadata/http'
import { UploadError, uploadBook } from '#/lib/scanner'
import { requireAdmin } from '#/lib/user-functions'

// The Market (admin only): browse the sources set up in Settings through
// their integrations (src/lib/market), and add books to the library.

const str = (value: unknown, max = 2000) =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

const message = (err: unknown) =>
  err instanceof Error ? err.message : 'Request failed'

function loadSource(sourceId: number) {
  const row = db
    .select()
    .from(marketSources)
    .where(eq(marketSources.id, sourceId))
    .get()
  if (!row) throw new Error('Source not found')
  const integration = getIntegration(row.integration)
  return {
    row,
    integration,
    ctx: createContext(String(row.id), row.settings),
  }
}

// Market books already in the library, as "<source id>:<book id>" → library
// book id.
function inLibrary(refs: Array<{ source: number; id: string }>) {
  if (!refs.length) return {}
  const rows = db
    .select({
      bookId: bookSources.bookId,
      sourceId: bookSources.sourceId,
      externalId: bookSources.externalId,
    })
    .from(bookSources)
    .where(
      and(
        inArray(bookSources.sourceId, [...new Set(refs.map((r) => r.source))]),
        inArray(bookSources.externalId, [...new Set(refs.map((r) => r.id))]),
      ),
    )
    .all()
  return Object.fromEntries(
    rows.map((r) => [`${r.sourceId}:${r.externalId}`, r.bookId]),
  ) as Record<string, string>
}

export const listMarketSources = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requireAdmin()
    const rows = db
      .select()
      .from(marketSources)
      .orderBy(asc(marketSources.id))
      .all()
    return rows.flatMap((row) => {
      const integration = INTEGRATIONS[row.integration]
      if (!integration) return []
      // Passwords never leave the server.
      const hidden = new Set(
        integration.settings
          .filter((f) => f.type === 'password')
          .map((f) => f.key),
      )
      return [
        {
          id: row.id,
          name: row.name,
          integration: integration.name,
          searchable: Boolean(integration.search),
          settings: Object.fromEntries(
            Object.entries(row.settings).filter(([k]) => !hidden.has(k)),
          ),
        },
      ]
    })
  },
)

export const listIntegrations = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requireAdmin()
    return Object.values(INTEGRATIONS).map((i) => ({
      id: i.id,
      name: i.name,
      settings: i.settings,
    }))
  },
)

export const addMarketSource = createServerFn({ method: 'POST' })
  .validator(
    (data: {
      integration: string
      name: string
      settings: Record<string, string>
    }) => {
      const integration = getIntegration(str(data.integration, 100))
      const settings: Record<string, string> = {}
      for (const field of integration.settings) {
        const value = str(data.settings?.[field.key])
        if (field.required && !value) throw new Error(`Enter ${field.label}`)
        if (field.type === 'url' && value && !/^https?:\/\/\S+$/i.test(value)) {
          throw new Error(`${field.label} must be an http(s) URL`)
        }
        if (value) settings[field.key] = value
      }
      return {
        integration: integration.id,
        name: str(data.name, 100) || integration.name,
        settings,
      }
    },
  )
  .handler(async ({ data }) => {
    await requireAdmin()
    const integration = getIntegration(data.integration)
    // A throwaway cache, so a failed check isn't remembered.
    const cacheKey = `check:${crypto.randomUUID()}`
    const ctx = createContext(cacheKey, data.settings)
    try {
      await (integration.check ?? integration.home)(ctx)
    } catch (err) {
      throw new Error(`Could not connect: ${message(err)}`)
    } finally {
      clearCache(cacheKey)
    }
    db.insert(marketSources).values(data).run()
  })

export const removeMarketSource = createServerFn({ method: 'POST' })
  .validator((id: number) => Number(id))
  .handler(async ({ data: id }) => {
    await requireAdmin()
    db.delete(marketSources).where(eq(marketSources.id, id)).run()
    clearCache(String(id))
  })

export type MarketView = Awaited<ReturnType<typeof marketBrowse>>

// Every source's home, or a listing: search results (`q`, from every source
// with search) or a shelf (`shelf`, one id per source, since shelves with the
// same name are merged). `cursors` fetches the next page of the sources it
// names. Each source answers on its own: one failing doesn't hide the others.
export const marketBrowse = createServerFn({ method: 'GET' })
  .validator(
    (data: {
      q?: string
      shelf?: Array<{ source: number; id: string }>
      cursors?: Record<string, string>
    }) => ({
      q: str(data.q, 200) || null,
      shelf: Array.isArray(data.shelf)
        ? data.shelf.map((r) => ({ source: Number(r.source), id: str(r.id) }))
        : null,
      cursors: Object.fromEntries(
        Object.entries(data.cursors ?? {}).map(([k, v]) => [Number(k), str(v)]),
      ) as Record<number, string>,
    }),
  )
  .handler(async ({ data }) => {
    await requireAdmin()
    const sources = db
      .select()
      .from(marketSources)
      .orderBy(asc(marketSources.id))
      .all()
      .filter((row) => INTEGRATIONS[row.integration])
      .map((row) => ({
        row,
        integration: INTEGRATIONS[row.integration],
        ctx: createContext(String(row.id), row.settings),
      }))
    const paging = Object.keys(data.cursors).length > 0

    async function each<S extends (typeof sources)[number], T>(
      list: S[],
      load: (source: S) => Promise<T>,
    ) {
      return Promise.all(
        list.map(async (source) => {
          const base = { source: source.row.id, sourceName: source.row.name }
          try {
            return { ...base, value: await load(source), error: null }
          } catch (err) {
            return { ...base, value: null, error: message(err) }
          }
        }),
      )
    }

    if (!data.q && !data.shelf) {
      const results = await each(sources, async (s) =>
        cleanHome(await s.integration.home(s.ctx)),
      )
      const ids = results.flatMap((r) =>
        (r.value?.rows ?? []).flatMap((row) =>
          row.books.map((b) => ({ source: r.source, id: b.id })),
        ),
      )
      return { kind: 'home' as const, results, inLibrary: inLibrary(ids) }
    }

    const targets = sources.flatMap((s) => {
      const cursor = data.cursors[s.row.id] ?? null
      if (paging && !cursor) return []
      if (data.q)
        return s.integration.search ? [{ ...s, id: data.q, cursor }] : []
      const ref = data.shelf!.find((r) => r.source === s.row.id)
      return ref ? [{ ...s, id: ref.id, cursor }] : []
    })
    const results = await each(targets, async (t) =>
      cleanListing(
        data.q
          ? await t.integration.search!(t.ctx, t.id, t.cursor)
          : await t.integration.shelf(t.ctx, t.id, t.cursor),
      ),
    )
    const ids = results.flatMap((r) =>
      (r.value?.books ?? []).map((b) => ({ source: r.source, id: b.id })),
    )
    return { kind: 'listing' as const, results, inLibrary: inLibrary(ids) }
  })

export const marketBook = createServerFn({ method: 'GET' })
  .validator((data: { sourceId: number; bookId: string }) => ({
    sourceId: Number(data.sourceId),
    bookId: str(data.bookId),
  }))
  .handler(async ({ data }) => {
    await requireAdmin()
    const { row, integration, ctx } = loadSource(data.sourceId)
    const book = cleanDetails(await integration.book(ctx, data.bookId))
    return {
      book: { ...book, id: data.bookId },
      libraryBookId:
        inLibrary([{ source: row.id, id: data.bookId }])[
          `${row.id}:${data.bookId}`
        ] ?? null,
    }
  })

// Downloads a format into the library, records where it came from, and fills
// in metadata the EPUB lacks. Returns the library book id.
export const marketAdd = createServerFn({ method: 'POST' })
  .validator(
    (data: { sourceId: number; bookId: string; formatId: string }) => ({
      sourceId: Number(data.sourceId),
      bookId: str(data.bookId),
      formatId: str(data.formatId),
    }),
  )
  .handler(async ({ data }) => {
    await requireAdmin()
    const { row, integration, ctx } = loadSource(data.sourceId)
    const existing = inLibrary([{ source: row.id, id: data.bookId }])[
      `${row.id}:${data.bookId}`
    ]
    if (existing) return { bookId: existing }

    const details = cleanDetails(await integration.book(ctx, data.bookId))
    const res = await integration.download(
      createContext(String(row.id), row.settings, DOWNLOAD_TIMEOUT_MS),
      data.bookId,
      data.formatId,
    )
    if (!(res instanceof Response) || !res.ok || !res.body) {
      throw new Error('Download failed')
    }

    let bookId: string
    try {
      ;({ bookId } = await uploadBook(
        `${details.title}.epub`,
        res.body as WebReadableStream<Uint8Array>,
      ))
    } catch (err) {
      if (err instanceof UploadError) throw new Error('Not a valid EPUB')
      throw err
    }

    db.insert(bookSources)
      .values({
        bookId,
        sourceId: row.id,
        integration: integration.id,
        externalId: data.bookId,
      })
      .onConflictDoNothing()
      .run()
    await fillMetadata(bookId, details, integration.id, data.bookId)
    return { bookId }
  })

// Sets matched fields only where the EPUB has nothing, so the file's own
// metadata wins; "Revert to file metadata" undoes it like any match.
async function fillMetadata(
  bookId: string,
  details: ReturnType<typeof cleanDetails>,
  integration: string,
  externalId: string,
) {
  const book = db.select().from(books).where(eq(books.id, bookId)).get()
  if (!book || book.matched) return
  const view = bookView(book)
  const matched: MatchedMetadata = {}
  for (const key of [
    'description',
    'language',
    'publisher',
    'publishedDate',
    'isbn',
  ] as const) {
    if (!view[key] && details[key]) matched[key] = details[key]
  }
  if (!view.coverPath && details.coverUrl) {
    try {
      const cover = await downloadCover(details.coverUrl)
      const name = `${bookId}-matched.${cover.ext}`
      const dir = path.join(config.dataDir, 'covers')
      await fsp.mkdir(dir, { recursive: true })
      await fsp.writeFile(path.join(dir, name), cover.data)
      matched.coverPath = `covers/${name}`
    } catch {
      // The book is added either way.
    }
  }
  if (!Object.keys(matched).length) return
  matched.source = {
    provider: integration,
    id: externalId,
    matchedAt: new Date().toISOString(),
  }
  db.update(books).set({ matched }).where(eq(books.id, bookId)).run()
}
