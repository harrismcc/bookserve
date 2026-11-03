import { config } from '#/lib/config'
import { htmlToText } from '#/lib/epub'
import { HttpError, fetchJson } from '#/lib/metadata/http'
import type { Candidate, MetadataProvider } from '#/lib/metadata/providers'
import { bookKeys } from '#/lib/market/merge'
import { foldName as fold } from '#/lib/utils'

// Hardcover (https://docs.hardcover.app/api): GraphQL with a token from
// HARDCOVER_TOKEN. Free tokens get 60 requests a minute and 5,000 a day, so
// everything but matching goes through `cached`.

const API_URL = 'https://api.hardcover.app/v1/graphql'
const SITE_URL = 'https://hardcover.app'

export const hardcoverEnabled = () => Boolean(config.hardcoverToken)

async function gql<T>(query: string, variables: Record<string, unknown>) {
  if (!config.hardcoverToken) throw new Error('Set HARDCOVER_TOKEN')
  let res: { data?: T; errors?: Array<{ message?: string }> }
  try {
    res = await fetchJson(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.hardcoverToken}`,
      },
      body: JSON.stringify({ query, variables }),
    })
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) {
      throw new Error('Token rejected; check HARDCOVER_TOKEN')
    }
    if (err instanceof HttpError && err.status === 429) {
      throw new Error('Rate limited; try again later')
    }
    throw err
  }
  if (!res.data) throw new Error(res.errors?.[0]?.message ?? 'Invalid response')
  return res.data
}

// Results by key for a day; failures aren't cached. One map for the process,
// so every user shares the request budget.
const TTL_MS = 24 * 60 * 60 * 1000
const MAX_ENTRIES = 500
const cache = new Map<string, { expires: number; value: Promise<unknown> }>()

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) return hit.value as Promise<T>
  const value = load()
  cache.delete(key)
  cache.set(key, { expires: Date.now() + TTL_MS, value })
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!)
  value.catch(() => cache.delete(key))
  return value
}

type Image = { url?: string | null } | null | undefined
type Contributor = { contribution?: string | null; author?: { name?: string } }

// A Hardcover book, as shown on discovery rows.
export type HardcoverBook = {
  id: number
  title: string
  authors: string[]
  coverUrl: string | null
  url: string
}

type BookRow = {
  id: number
  title: string
  slug: string
  cached_image: Image
  cached_contributors: Contributor[]
}

const BOOK_FIELDS = 'id title slug cached_image cached_contributors'

// Writers only: translators, illustrators and editors are left out.
const writers = (contributors: Contributor[] = []) =>
  contributors
    .filter((c) => !c.contribution || c.contribution === 'Author')
    .map((c) => c.author?.name ?? '')
    .filter(Boolean)

const toBook = (row: BookRow): HardcoverBook => ({
  id: row.id,
  title: row.title,
  authors: writers(row.cached_contributors),
  coverUrl: row.cached_image?.url ?? null,
  url: `${SITE_URL}/books/${row.slug}`,
})

type SearchDoc = {
  id: string
  title?: string
  slug?: string
  author_names?: string[]
  contributions?: Contributor[]
  isbns?: string[]
  description?: string | null
  release_year?: number | null
  pages?: number | null
  image?: Image
  featured_series?: { series?: { name?: string } } | null
  featured_series_position?: number | null
}

async function searchBooks(query: string, perPage: number) {
  const data = await gql<{
    search: { results?: { hits?: Array<{ document: SearchDoc }> } }
  }>(
    `query($q: String!, $n: Int!) {
      search(query: $q, query_type: "Book", per_page: $n) { results }
    }`,
    { q: query, n: perPage },
  )
  return (data.search.results?.hits ?? []).map((h) => h.document)
}

function pickIsbn(isbns: string[] = [], wanted: string) {
  if (wanted && isbns.includes(wanted)) return wanted
  return isbns.find((i) => /^97[89]\d{10}$/.test(i)) ?? isbns[0] ?? null
}

const docAuthors = (doc: SearchDoc) =>
  doc.contributions ? writers(doc.contributions) : (doc.author_names ?? [])

export const hardcover: MetadataProvider = {
  async search({ title, author, isbn }) {
    if (!hardcoverEnabled()) return []
    const docs = await searchBooks(isbn || [title, author].join(' '), 10)
    return docs.map((doc): Candidate => ({
      provider: 'hardcover',
      id: doc.id,
      title: doc.title ?? '',
      authors: docAuthors(doc),
      description: doc.description ? htmlToText(doc.description) || null : null,
      publisher: null,
      publishedDate: doc.release_year ? String(doc.release_year) : null,
      isbn: pickIsbn(doc.isbns, isbn),
      language: null,
      series: doc.featured_series?.series?.name ?? null,
      seriesIndex: doc.featured_series_position ?? null,
      pageCount: doc.pages ?? null,
      coverUrl: doc.image?.url ?? null,
      thumbnailUrl: doc.image?.url ?? null,
    }))
  },
}

type LibraryBook = { title: string; authors: string[]; isbn: string | null }

// The Hardcover id of a library book: the one it was matched to, else the
// first search result that is the same work (same ISBN, or title and author).
export function findHardcoverBook(book: LibraryBook, matchedId?: string) {
  if (matchedId && /^\d+$/.test(matchedId)) {
    return Promise.resolve(Number(matchedId))
  }
  const queries = [book.isbn, `${book.title} ${book.authors[0] ?? ''}`.trim()]
  return cached(`find:${JSON.stringify(queries)}`, async () => {
    const wanted = new Set(bookKeys(book))
    // Hardcover doesn't know every ISBN (ebook ISBNs especially), and answers
    // an unknown one with unrelated books; then try the title.
    for (const query of queries) {
      if (!query) continue
      const docs = await searchBooks(query, 5)
      const doc = docs.find((d) =>
        [null, ...(d.isbns ?? [])].some((isbn) =>
          bookKeys({ title: d.title ?? '', authors: docAuthors(d), isbn }).some(
            (k) => wanted.has(k),
          ),
        ),
      )
      if (doc) return Number(doc.id)
    }
    return null
  })
}

type Tags = Record<string, Array<{ tag?: string }> | undefined>

export type HardcoverBookDetails = {
  url: string
  rating: number | null
  ratingsCount: number
  genres: string[]
  moods: string[]
  series: { name: string; position: number | null } | null
  author: string | null
  similar: HardcoverBook[]
}

export function hardcoverBookDetails(id: number) {
  return cached(
    `book:${id}`,
    async (): Promise<HardcoverBookDetails | null> => {
      const { book } = await gql<{
        book: {
          slug: string
          rating: number | null
          ratings_count: number
          cached_tags: Tags
          cached_similar_book_ids: number[]
          cached_contributors: Contributor[]
          book_series: Array<{
            position: number | null
            series: { name: string }
          }>
        } | null
      }>(
        `query($id: Int!) {
        book: books_by_pk(id: $id) {
          slug rating ratings_count cached_tags cached_similar_book_ids
          cached_contributors
          book_series(limit: 1, order_by: { featured: desc }) {
            position series { name }
          }
        }
      }`,
        { id },
      )
      if (!book) return null
      const ids = (book.cached_similar_book_ids ?? []).slice(0, 12)
      const similar = ids.length ? await booksById(ids) : []
      const tags = (key: string, limit: number) =>
        (book.cached_tags?.[key] ?? [])
          .slice(0, limit)
          .map((t) => t.tag ?? '')
          .filter(Boolean)
          .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
      const series = book.book_series[0]
      return {
        url: `${SITE_URL}/books/${book.slug}`,
        rating: book.ratings_count ? book.rating : null,
        ratingsCount: book.ratings_count,
        genres: tags('Genre', 3),
        moods: tags('Mood', 2),
        series: series
          ? { name: series.series.name, position: series.position }
          : null,
        author: writers(book.cached_contributors)[0] ?? null,
        similar,
      }
    },
  )
}

// In the order of `ids`.
async function booksById(ids: number[]) {
  const { books } = await gql<{ books: BookRow[] }>(
    `query($ids: [Int!]!) {
      books(where: { id: { _in: $ids } }) { ${BOOK_FIELDS} }
    }`,
    { ids },
  )
  const byId = new Map(books.map((b) => [b.id, toBook(b)]))
  return ids.flatMap((id) => byId.get(id) ?? [])
}

export type HardcoverAuthor = {
  name: string
  url: string
  bio: string | null
  born: number | null
  died: number | null
  books: HardcoverBook[]
}

// The author with exactly this name (ignoring case and punctuation) and their
// most read books.
export function hardcoverAuthor(name: string) {
  return cached(`author:${fold(name)}`, async () => {
    const found = await gql<{
      search: {
        results?: { hits?: Array<{ document: { id: string; name: string } }> }
      }
    }>(
      `query($q: String!) {
        search(query: $q, query_type: "Author", per_page: 5) { results }
      }`,
      { q: name },
    )
    const hit = found.search.results?.hits?.find(
      (h) => fold(h.document.name) === fold(name),
    )
    if (!hit) return null
    const { author } = await gql<{
      author: {
        name: string
        slug: string
        bio: string | null
        born_year: number | null
        death_year: number | null
        contributions: Array<{ book: BookRow }>
      } | null
    }>(
      `query($id: Int!) {
        author: authors_by_pk(id: $id) {
          name slug bio born_year death_year
          contributions(
            where: {
              contributable_type: { _eq: "Book" }
              _or: [{ contribution: { _is_null: true } }, { contribution: { _eq: "Author" } }]
              book: { canonical_id: { _is_null: true }, compilation: { _eq: false } }
            }
            order_by: { book: { users_count: desc } }
            limit: 24
          ) { book { ${BOOK_FIELDS} } }
        }
      }`,
      { id: Number(hit.document.id) },
    )
    if (!author) return null
    return {
      name: author.name,
      url: `${SITE_URL}/authors/${author.slug}`,
      // Bios copied from Wikipedia keep its footnote marks: "[2][b]".
      bio: author.bio
        ? htmlToText(author.bio).replace(/\[\w{1,3}\]/g, '') || null
        : null,
      born: author.born_year,
      died: author.death_year,
      // One book per work: editions and retitlings are separate books.
      books: author.contributions
        .map((c) => toBook(c.book))
        .filter((book, i, all) => {
          const key = bookKeys({ ...book, isbn: null })[0]
          return (
            !key ||
            all.findIndex((b) => bookKeys({ ...b, isbn: null })[0] === key) ===
              i
          )
        }),
    } satisfies HardcoverAuthor
  })
}

export type HardcoverSeries = {
  name: string
  url: string
  books: Array<HardcoverBook & { position: number }>
}

// The series with this name, by `author` when given, with one book per
// position and per work (the most read: no omnibuses, translations or
// split volumes, which Hardcover numbers 1.1, 1.2…).
export function hardcoverSeries(name: string, author: string | null) {
  return cached(`series:${fold(name)}|${fold(author ?? '')}`, async () => {
    const found = await gql<{
      search: {
        results?: {
          hits?: Array<{
            document: { id: string; name: string; author_name?: string }
          }>
        }
      }
    }>(
      `query($q: String!) {
        search(query: $q, query_type: "Series", per_page: 5) { results }
      }`,
      { q: author ? `${name} ${author}` : name },
    )
    const hit = found.search.results?.hits?.find(
      (h) =>
        fold(h.document.name) === fold(name) &&
        (!author || fold(h.document.author_name ?? '') === fold(author)),
    )
    if (!hit) return null
    const { series } = await gql<{
      series: {
        name: string
        slug: string
        book_series: Array<{ position: number; book: BookRow }>
      } | null
    }>(
      `query($id: Int!) {
        series: series_by_pk(id: $id) {
          name slug
          book_series(
            where: {
              compilation: { _eq: false }
              position: { _is_null: false }
              book: { canonical_id: { _is_null: true } }
            }
            order_by: [{ position: asc }, { book: { users_count: desc } }]
          ) { position book { ${BOOK_FIELDS} } }
        }
      }`,
      { id: Number(hit.document.id) },
    )
    if (!series) return null
    const positions = new Set(series.book_series.map((s) => s.position))
    const seen = new Set<number | string>()
    return {
      name: series.name,
      url: `${SITE_URL}/series/${series.slug}`,
      books: series.book_series.flatMap((s) => {
        const book = toBook(s.book)
        const work = bookKeys({ ...book, isbn: null })[0]
        const part = !Number.isInteger(s.position * 2) // not 1 or 1.5
        if (part && positions.has(Math.floor(s.position))) return []
        if (seen.has(s.position) || (work && seen.has(work))) return []
        seen.add(s.position)
        if (work) seen.add(work)
        return [{ ...book, position: s.position }]
      }),
    } satisfies HardcoverSeries
  })
}
