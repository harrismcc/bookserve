import { XMLParser } from 'fast-xml-parser'

import { htmlToText } from '#/lib/epub'

// Parses OPDS 1.x catalogs (Atom feeds) for the integrations built on them.
// No fetching here: integrations fetch through their context.

export type OpdsDownload = { title: string; href: string; size: number | null }

export type OpdsEntry = {
  id: string
  title: string
  authors: string[]
  summary: string | null
  // Another feed to browse (navigation entries).
  href: string | null
  coverUrl: string | null
  // EPUB acquisition links, in feed order.
  downloads: OpdsDownload[]
  // rel="related" feeds (more by the author, same subject...).
  related: Array<{ title: string; href: string }>
  language: string | null
  subjects: string[]
  publisher: string | null
  issued: string | null
  isbn: string | null
}

export type OpdsFeed = {
  url: string
  title: string
  entries: OpdsEntry[]
  next: string | null
  // The rel="search" link: an Atom URL template, or an OpenSearch description.
  search: { href: string; openSearch: boolean } | null
  // The catalog's popular and new feeds (rel="http://opds-spec.org/sort/…").
  popular: string | null
  new: string | null
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  // Content may be (escaped) HTML or XHTML; keep it raw for htmlToText.
  stopNodes: ['*.content', '*.summary'],
  isArray: (name) =>
    [
      'entry',
      'link',
      'author',
      'Url',
      'category',
      'language',
      'identifier',
    ].includes(name),
})

type Node = string | ({ '#text'?: string } & Record<string, unknown>)
type Link = {
  rel: string
  type: string
  href: string
  title: string
  size: number | null
}

const text = (node: Node | undefined) =>
  (typeof node === 'string' ? node : (node?.['#text'] ?? '')).toString().trim()

const attr = (node: Node | undefined, name: string) =>
  typeof node === 'object' && node[`@_${name}`] != null
    ? String(node[`@_${name}`])
    : ''

const isFeed = (type: string) => type.startsWith('application/atom+xml')

// Catalogs often list authors as "Last, First"; show "First Last".
const displayName = (name: string) =>
  name.replace(/^([^,]+), ([^,]+)$/, '$2 $1')

// Resolves an href against the feed URL; http(s) only.
export function resolveUrl(href: string, base: string) {
  try {
    const url = new URL(href, base)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

function links(node: { link?: Node[] }, base: string): Link[] {
  return (node.link ?? []).flatMap((l) => {
    const raw = attr(l, 'href')
    // Search templates hold {placeholders}; resolve them after filling in.
    const href = raw.includes('{') ? raw : resolveUrl(raw, base)
    if (!href) return []
    return [
      {
        rel: attr(l, 'rel'),
        type: attr(l, 'type'),
        href,
        title: attr(l, 'title'),
        size: Number(attr(l, 'length')) || null,
      },
    ]
  })
}

function parseEntry(entry: Record<string, unknown>, base: string): OpdsEntry {
  const all = links(entry, base)
  const image =
    all.find((l) => l.rel === 'http://opds-spec.org/image') ??
    all.find((l) => l.rel === 'http://opds-spec.org/image/thumbnail')
  const nav = all.find(
    (l) =>
      isFeed(l.type) &&
      !['related', 'self', 'alternate'].includes(l.rel) &&
      !l.rel.startsWith('http://opds-spec.org/acquisition'),
  )
  const summary = htmlToText(
    text((entry.summary ?? entry.content) as Node | undefined),
  )
  return {
    id: text(entry.id as Node) || nav?.href || text(entry.title as Node),
    title: text(entry.title as Node) || 'Untitled',
    authors: ((entry.author ?? []) as Array<Record<string, Node>>)
      .map((a) => displayName(text(a.name)))
      .filter(Boolean),
    summary: summary || null,
    href: nav?.href ?? null,
    coverUrl: image?.href ?? null,
    downloads: all
      .filter(
        (l) =>
          l.rel.startsWith('http://opds-spec.org/acquisition') &&
          l.type.startsWith('application/epub+zip'),
      )
      .map((l) => ({ title: l.title || 'EPUB', href: l.href, size: l.size })),
    related: all
      .filter((l) => l.rel === 'related' && isFeed(l.type) && l.title)
      .map((l) => ({ title: l.title, href: l.href })),
    language: text((entry.language as Node[] | undefined)?.[0]) || null,
    // Skip classification schemes that aren't subjects (LCC, DCMI type).
    subjects: ((entry.category ?? []) as Node[])
      .filter((c) => !/\/(LCC|DCMIType)$/.test(attr(c, 'scheme')))
      .map((c) => attr(c, 'label') || attr(c, 'term'))
      .filter(Boolean),
    publisher: text(entry.publisher as Node) || null,
    issued: text((entry.issued ?? entry.published) as Node) || null,
    isbn:
      ((entry.identifier ?? []) as Node[])
        .map((i) => text(i).match(/^urn:isbn:([\dX-]+)$/i)?.[1])
        .find(Boolean) ?? null,
  }
}

// `url` is the URL the feed was fetched from (after redirects).
export function parseFeed(xml: string, url: string): OpdsFeed {
  const feed = parser.parse(xml)?.feed
  if (!feed) throw new Error('Not an OPDS catalog')
  const feedLinks = links(feed, url)
  const search = feedLinks.find((l) => l.rel === 'search')
  const sortLink = (sort: string) =>
    feedLinks.find(
      (l) => l.rel === `http://opds-spec.org/sort/${sort}` && isFeed(l.type),
    )?.href ?? null
  return {
    url,
    title: text(feed.title) || 'Catalog',
    entries: ((feed.entry ?? []) as Array<Record<string, unknown>>).map((e) =>
      parseEntry(e, url),
    ),
    next:
      feedLinks.find((l) => l.rel === 'next' && isFeed(l.type))?.href ?? null,
    search: search
      ? { href: search.href, openSearch: !isFeed(search.type) }
      : null,
    popular: sortLink('popular'),
    new: sortLink('new'),
  }
}

// The Atom URL template from an OpenSearch description.
export function parseOpenSearch(xml: string) {
  const urls = (parser.parse(xml)?.OpenSearchDescription?.Url ?? []) as Node[]
  return (
    attr(
      urls.find((u) => isFeed(attr(u, 'type'))),
      'template',
    ) || null
  )
}

// Fills {searchTerms} (dropping other placeholders) and resolves the result.
export function fillSearchTemplate(
  template: string,
  query: string,
  base: string,
) {
  return resolveUrl(
    template
      .replace(/\{searchTerms\}/g, encodeURIComponent(query))
      .replace(/\{[^}]*\}/g, ''),
    base,
  )
}
