import { config } from '#/lib/config'
import { htmlToText } from '#/lib/epub'
import { HttpError, fetchJson } from '#/lib/metadata/http'
import type { Candidate, MetadataProvider } from '#/lib/metadata/providers'

const BASE_URL = 'https://www.googleapis.com/books/v1'

type Volume = {
  id: string
  volumeInfo?: {
    title?: string
    authors?: string[]
    publisher?: string
    publishedDate?: string
    description?: string
    industryIdentifiers?: Array<{ type: string; identifier: string }>
    pageCount?: number
    language?: string
    imageLinks?: Record<string, string | undefined>
  }
}

const IMAGE_SIZES = [
  'extraLarge',
  'large',
  'medium',
  'small',
  'thumbnail',
  'smallThumbnail',
]

// Google serves cover links over http and with a page-curl effect.
const cleanImage = (url: string | undefined) =>
  url ? url.replace(/^http:/, 'https:').replace(/&edge=curl/, '') : null

function isbnOf(ids: Array<{ type: string; identifier: string }> = []) {
  const find = (type: string) => ids.find((i) => i.type === type)?.identifier
  return find('ISBN_13') ?? find('ISBN_10') ?? null
}

export const googleBooks: MetadataProvider = {
  async search({ title, author, isbn }) {
    const q = isbn
      ? `isbn:${isbn}`
      : [title && `intitle:${title}`, author && `inauthor:${author}`]
          .filter(Boolean)
          .join(' ')
    const params = new URLSearchParams({
      q,
      maxResults: '10',
      printType: 'books',
    })
    if (config.googleBooksApiKey) params.set('key', config.googleBooksApiKey)

    let data: { items?: Volume[] }
    try {
      data = await fetchJson(`${BASE_URL}/volumes?${params}`)
    } catch (err) {
      // Keyless requests share one project whose daily quota is exhausted.
      if (err instanceof HttpError && err.status === 429) {
        throw new Error(
          config.googleBooksApiKey
            ? 'Quota exceeded'
            : 'Quota exceeded; set GOOGLE_BOOKS_API_KEY',
        )
      }
      throw err
    }

    return (data.items ?? []).map((item): Candidate => {
      const info = item.volumeInfo ?? {}
      const images = info.imageLinks ?? {}
      const date = info.publishedDate?.match(/^\d{4}(-\d{2}(-\d{2})?)?/)?.[0]
      return {
        provider: 'google',
        id: item.id,
        title: info.title ?? '',
        authors: info.authors ?? [],
        description: info.description
          ? htmlToText(info.description) || null
          : null,
        publisher: info.publisher ?? null,
        publishedDate: date ?? null,
        isbn: isbnOf(info.industryIdentifiers),
        language: info.language ?? null,
        series: null,
        seriesIndex: null,
        pageCount: info.pageCount || null,
        coverUrl: cleanImage(
          IMAGE_SIZES.map((size) => images[size]).find(Boolean),
        ),
        thumbnailUrl: cleanImage(images.thumbnail ?? images.smallThumbnail),
      }
    })
  },
}
