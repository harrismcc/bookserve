import path from 'node:path'

import { requestUser, unauthorized } from '#/lib/auth'
import type { bookView } from '#/lib/books'
import { config } from '#/lib/config'
import { getSetting } from '#/lib/settings'

// Builds the OPDS 1.2 catalog (Atom feeds) that serves the library to reading
// apps. Routes live under src/routes/opds; files come from /api/books/$id/*.

export const NAVIGATION =
  'application/atom+xml;profile=opds-catalog;kind=navigation'
export const ACQUISITION =
  'application/atom+xml;profile=opds-catalog;kind=acquisition'
export const OPENSEARCH = 'application/opensearchdescription+xml'

const IMAGE_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
}

// Escapes text for XML, dropping control characters XML 1.0 can't contain.
export const xml = (value: string) =>
  value
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[&<>"']/g, (c) => ENTITIES[c])

type Link = { rel: string; href: string; type: string; title?: string }

const link = ({ rel, href, type, title }: Link) =>
  `<link rel="${xml(rel)}" href="${xml(href)}" type="${xml(type)}"${title ? ` title="${xml(title)}"` : ''}/>`

// The response for a catalog request that may not proceed: not found while
// the OPDS server is turned off in Settings, or a Basic credentials challenge.
export async function deniedResponse(request: Request) {
  if (!getSetting('opdsEnabled')) {
    return new Response('Not Found', { status: 404 })
  }
  if (!(await requestUser(request))) return unauthorized()
  return null
}

// The public origin, for the absolute URLs OpenSearch templates need.
export function publicOrigin(request: Request) {
  if (config.publicUrl) return new URL(config.publicUrl).origin
  const url = new URL(request.url)
  const first = (name: string) =>
    request.headers.get(name)?.split(',')[0].trim()
  const proto = first('x-forwarded-proto') ?? url.protocol.slice(0, -1)
  return `${proto}://${first('x-forwarded-host') ?? url.host}`
}

export function feed(options: {
  id: string
  title: string
  type: string
  links: Link[]
  entries: string[]
  updated?: Date
}) {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/terms/" xmlns:opds="http://opds-spec.org/2010/catalog" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
<id>${xml(options.id)}</id>
<title>${xml(options.title)}</title>
<updated>${(options.updated ?? new Date()).toISOString()}</updated>
<author><name>Bookserve</name></author>
${[
  link({ rel: 'start', href: '/opds', type: NAVIGATION }),
  link({ rel: 'search', href: '/opds/search', type: OPENSEARCH }),
  ...options.links.map(link),
  ...options.entries,
].join('\n')}
</feed>
`
  return new Response(body, {
    headers: {
      'content-type': `${options.type};charset=utf-8`,
      'cache-control': 'private, no-cache',
    },
  })
}

export const navigationEntry = (entry: {
  id: string
  title: string
  href: string
  type: string
}) =>
  `<entry><title>${xml(entry.title)}</title><id>${xml(entry.id)}</id><updated>${new Date().toISOString()}</updated>${link({ rel: 'subsection', href: entry.href, type: entry.type })}</entry>`

export function bookEntry(book: ReturnType<typeof bookView>) {
  const parts = [
    `<title>${xml(book.title)}</title>`,
    `<id>urn:bookserve:book:${xml(book.id)}</id>`,
    `<updated>${book.updatedAt.toISOString()}</updated>`,
    ...book.authors.map((name) => `<author><name>${xml(name)}</name></author>`),
  ]
  if (book.language)
    parts.push(`<dc:language>${xml(book.language)}</dc:language>`)
  if (book.publisher) {
    parts.push(`<dc:publisher>${xml(book.publisher)}</dc:publisher>`)
  }
  if (book.publishedDate) {
    parts.push(`<dc:issued>${xml(book.publishedDate)}</dc:issued>`)
  }
  if (book.isbn) {
    parts.push(`<dc:identifier>urn:isbn:${xml(book.isbn)}</dc:identifier>`)
  }
  if (book.description)
    parts.push(`<summary>${xml(book.description)}</summary>`)
  if (book.coverPath) {
    const href = `/api/books/${book.id}/cover?v=${book.updatedAt.getTime()}`
    const type = IMAGE_TYPES[path.extname(book.coverPath)] ?? 'image/jpeg'
    parts.push(
      link({ rel: 'http://opds-spec.org/image', href, type }),
      link({ rel: 'http://opds-spec.org/image/thumbnail', href, type }),
    )
  }
  parts.push(
    link({
      rel: 'http://opds-spec.org/acquisition',
      href: `/api/books/${book.id}/download`,
      type: 'application/epub+zip',
    }),
  )
  return `<entry>${parts.join('')}</entry>`
}
