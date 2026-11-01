import path from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { XMLParser } from 'fast-xml-parser'

import type { BookMetadata } from '#/lib/books'

export type EpubCover = { data: Uint8Array; ext: string }

const COVER_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
}
const MAX_OPF_BYTES = 5 * 1024 * 1024
const MAX_COVER_BYTES = 20 * 1024 * 1024

const ARRAY_TAGS = new Set([
  'rootfile',
  'item',
  'meta',
  'title',
  'creator',
  'identifier',
  'date',
  'language',
  'publisher',
  'description',
])

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  // Descriptions often hold (escaped or raw) HTML; keep them as a raw string.
  stopNodes: ['*.description'],
  isArray: (name) => ARRAY_TAGS.has(name),
})

type Node = string | ({ '#text'?: string } & Record<string, unknown>)

const text = (node: Node | undefined) =>
  (typeof node === 'string' ? node : (node?.['#text'] ?? '')).toString().trim()
const attr = (node: Node | undefined, name: string) =>
  typeof node === 'object' && node[`@_${name}`] != null
    ? String(node[`@_${name}`])
    : undefined

// Decompresses only the named entry; throws if it is missing or too large.
function readEntry(zip: Uint8Array, name: string, maxBytes: number) {
  const files = unzipSync(zip, {
    filter: (f) => f.name === name && f.originalSize <= maxBytes,
  })
  const data = files[name]
  if (!data) throw new Error(`Missing or oversized entry: ${name}`)
  return data
}

// Reads metadata and the cover image from an EPUB. Throws on malformed files.
export function readEpub(zip: Uint8Array): {
  metadata: BookMetadata
  cover: EpubCover | null
} {
  const container = parser.parse(
    strFromU8(readEntry(zip, 'META-INF/container.xml', MAX_OPF_BYTES)),
  )
  const opfPath = attr(
    container?.container?.rootfiles?.rootfile?.[0],
    'full-path',
  )
  if (!opfPath) throw new Error('No rootfile in container.xml')

  const pkg = parser.parse(
    strFromU8(readEntry(zip, opfPath, MAX_OPF_BYTES)),
  )?.package
  if (!pkg?.metadata) throw new Error('No package metadata in OPF')
  const md = pkg.metadata as Record<string, Node[] | undefined>
  const metas = md.meta ?? []
  const items = (pkg.manifest?.item ?? []) as Node[]

  const refinement = (node: Node, property: string) => {
    const id = attr(node, 'id')
    const meta = id
      ? metas.find(
          (m) =>
            attr(m, 'refines') === `#${id}` && attr(m, 'property') === property,
        )
      : undefined
    return meta ? text(meta) : undefined
  }
  const first = (values: Node[] | undefined) => {
    const value = values?.map(text).find(Boolean)
    return value || null
  }

  const authors = (md.creator ?? [])
    .filter((c) => {
      const role = attr(c, 'role') ?? refinement(c, 'role')
      return !role || role === 'aut'
    })
    .map(text)
    .filter(Boolean)

  const dates = md.date ?? []
  const date =
    dates.find((d) => {
      const event = attr(d, 'event')
      return !event || event === 'publication'
    }) ?? dates[0]

  const isbn = (md.identifier ?? [])
    .map((id) => {
      const value = text(id)
      if (/^urn:isbn:/i.test(value)) return value.slice(9)
      if (/isbn/i.test(attr(id, 'scheme') ?? '')) return value
      return /^97[89][\d-]{10,14}$/.test(value) ? value : null
    })
    .find(Boolean)

  let series = metas.find((m) => attr(m, 'name') === 'calibre:series')
  let seriesName = series ? attr(series, 'content') : undefined
  let seriesIndex = attr(
    metas.find((m) => attr(m, 'name') === 'calibre:series_index'),
    'content',
  )
  if (!seriesName) {
    series = metas.find((m) => attr(m, 'property') === 'belongs-to-collection')
    if (series) {
      seriesName = text(series)
      seriesIndex = refinement(series, 'group-position')
    }
  }
  const index = seriesIndex ? Number.parseFloat(seriesIndex) : Number.NaN

  const metadata: BookMetadata = {
    title: first(md.title) ?? '',
    authors,
    description: htmlToText(first(md.description) ?? '') || null,
    language: first(md.language),
    publisher: first(md.publisher),
    publishedDate: date
      ? (text(date).match(/^\d{4}(-\d{2}(-\d{2})?)?/)?.[0] ?? null)
      : null,
    isbn: isbn ? isbn.replace(/[^\dX]/gi, '') : null,
    series: seriesName || null,
    seriesIndex: seriesName && Number.isFinite(index) ? index : null,
  }

  return { metadata, cover: readCover(zip, opfPath, items, metas) }
}

function readCover(
  zip: Uint8Array,
  opfPath: string,
  items: Node[],
  metas: Node[],
): EpubCover | null {
  const coverRef = attr(
    metas.find((m) => attr(m, 'name') === 'cover'),
    'content',
  )
  const isImage = (i: Node) => (attr(i, 'media-type') ?? '') in COVER_TYPES
  const item =
    // EPUB 3
    items.find((i) =>
      (attr(i, 'properties') ?? '').split(/\s+/).includes('cover-image'),
    ) ??
    // EPUB 2: <meta name="cover" content="<item id>">, sometimes an href
    (coverRef
      ? items.find(
          (i) => attr(i, 'id') === coverRef || attr(i, 'href') === coverRef,
        )
      : undefined) ??
    // Fallback: an image whose id or file name says "cover"
    items.find(
      (i) => isImage(i) && /cover/i.test(`${attr(i, 'id')} ${attr(i, 'href')}`),
    )
  const href = attr(item, 'href')
  const ext = COVER_TYPES[attr(item, 'media-type') ?? '']
  if (!item || !href || !ext) return null

  let name: string
  try {
    name = path.posix.join(
      path.posix.dirname(opfPath),
      decodeURIComponent(href),
    )
  } catch {
    return null
  }
  try {
    return { data: readEntry(zip, name, MAX_COVER_BYTES), ext }
  } catch {
    return null
  }
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
}

function decodeEntities(s: string) {
  return s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? match
    const n =
      code[1] === 'x' || code[1] === 'X'
        ? Number.parseInt(code.slice(2), 16)
        : Number.parseInt(code.slice(1), 10)
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match
  })
}

// OPF descriptions (and Google Books ones) are often (escaped) HTML. Reduce them
// to plain text with paragraph breaks; the UI renders the result as text, never as HTML.
export function htmlToText(html: string) {
  return decodeEntities(
    decodeEntities(html)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6])>/gi, '\n\n')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
