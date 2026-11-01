import { htmlToText } from '#/lib/epub'
import { fetchJson } from '#/lib/metadata/http'
import type { Candidate, MetadataProvider } from '#/lib/metadata/providers'

const BASE_URL = 'https://openlibrary.org'
const COVERS_URL = 'https://covers.openlibrary.org'
const FIELDS = [
  'key',
  'title',
  'author_name',
  'first_publish_year',
  'cover_i',
  'number_of_pages_median',
  // The edition that best matches the query, for edition-level fields.
  'editions',
  'editions.publisher',
  'editions.isbn',
  'editions.language',
].join(',')

type Doc = {
  key: string
  title?: string
  author_name?: string[]
  first_publish_year?: number
  cover_i?: number
  number_of_pages_median?: number
  editions?: {
    docs?: Array<{ publisher?: string[]; isbn?: string[]; language?: string[] }>
  }
}

// Covers by cover id (lookups by ISBN are rate-limited).
const cover = (id: number | undefined, size: 'M' | 'L') =>
  id ? `${COVERS_URL}/b/id/${id}-${size}.jpg` : null

// Prefer the ISBN that was searched for, else the edition's first ISBN-13.
function pickIsbn(isbns: string[] = [], wanted: string) {
  if (wanted && isbns.includes(wanted)) return wanted
  return isbns.find((i) => /^97[89]\d{10}$/.test(i)) ?? isbns[0] ?? null
}

// Work descriptions are often Markdown: drop emphasis, links and the
// "[1]: https://..." reference lines they point to.
const stripMarkdown = (text: string) =>
  text
    .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, '')
    .replace(/\[([^\]]*)\](\([^)]*\)|\[[^\]]*\])/g, '$1')
    .replace(/(\*\*|__|\*|_)(\S(?:.*?\S)?)\1/g, '$2')

export const openLibrary: MetadataProvider = {
  async search({ title, author, isbn }) {
    const params = new URLSearchParams({ fields: FIELDS, limit: '10' })
    if (isbn) {
      params.set('isbn', isbn)
    } else {
      if (title) params.set('title', title)
      if (author) params.set('author', author)
    }
    const data = await fetchJson<{ docs?: Doc[] }>(
      `${BASE_URL}/search.json?${params}`,
    )
    return (data.docs ?? []).map((doc): Candidate => {
      // Results are works; publisher, ISBN and language come from the
      // edition that best matches the query.
      const edition = doc.editions?.docs?.[0] ?? {}
      return {
        provider: 'openlibrary',
        // "/works/OL45883W" -> "OL45883W"
        id: doc.key.replace(/^\/works\//, ''),
        title: doc.title ?? '',
        authors: doc.author_name ?? [],
        description: null,
        publisher: edition.publisher?.[0] ?? null,
        publishedDate: doc.first_publish_year
          ? String(doc.first_publish_year)
          : null,
        isbn: pickIsbn(edition.isbn, isbn),
        language: edition.language?.[0] ?? null,
        series: null,
        seriesIndex: null,
        pageCount: doc.number_of_pages_median ?? null,
        coverUrl: cover(doc.cover_i, 'L'),
        thumbnailUrl: cover(doc.cover_i, 'M'),
        partial: true,
      }
    })
  },

  // The description is only on the work record: one extra request, made for
  // the candidate the user picked.
  async details(id) {
    if (!/^OL\d+W$/.test(id)) throw new Error('Invalid work id')
    const work = await fetchJson<{
      description?: string | { value?: string }
    }>(`${BASE_URL}/works/${id}.json`)
    const raw =
      typeof work.description === 'string'
        ? work.description
        : work.description?.value
    return { description: raw ? htmlToText(stripMarkdown(raw)) || null : null }
  },
}
