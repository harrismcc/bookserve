import type { BookSummary, Home, RowKind, ShelfLink } from '#/lib/market/sdk'

// Merges results from several sources into one list, deduplicating books
// that are the same work. Client-safe, so "Load more" merges the same way.

// A source's id for a book or shelf.
export type SourceRef = { source: number; id: string }

export type Offer = SourceRef & { sourceName: string; rating: number | null }

export type MergedBook = Omit<BookSummary, 'id'> & { offers: Offer[] }

export type MergedShelf = {
  title: string
  description: string | null
  refs: SourceRef[]
}

export type SourceResults<T> = {
  source: number
  sourceName: string
  items: T[]
}

// Lowercase, without accents or punctuation: "Science Fiction & Fantasy" and
// "science fiction and fantasy" are the same name.
const norm = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

// "The Adventures of Sherlock Holmes: Illustrated" → "adventures of sherlock holmes"
const workTitle = (title: string) =>
  norm(title.split(/\s*[:;([]\s*|\s+-{1,2}\s+/)[0]).replace(/^(the|a|an) /, '')

// "Jane Austen", "Austen, Jane", "Jane Austen (1775-1817)" → "austen";
// "Le Guin, Ursula K." and "Ursula K. Le Guin" → "guin".
function surname(author: string) {
  const name = author
    .replace(/\([^)]*\)/g, '')
    .replace(/,?\s*\b(jr|sr|ii|iii|iv)\b\.?\s*$/i, '')
  const comma = name.indexOf(',')
  const inverted = comma > 0 && /\p{L}/u.test(name.slice(comma + 1))
  const words = norm(inverted ? name.slice(0, comma) : name.replace(/,.*/, ''))
    .split(' ')
    .filter((w) => !/^\d+$/.test(w))
  return words.at(-1) ?? ''
}

function isbn13(isbn: string | null | undefined) {
  const value = (isbn ?? '').replace(/[\s-]/g, '').toUpperCase()
  if (/^\d{13}$/.test(value)) return value
  if (!/^\d{9}[\dX]$/.test(value)) return null
  const core = `978${value.slice(0, 9)}`
  const sum = [...core].reduce(
    (total, d, i) => total + Number(d) * (i % 2 ? 3 : 1),
    0,
  )
  return core + ((10 - (sum % 10)) % 10)
}

// "en-US" → "en".
const lang = (language: string | null | undefined) =>
  language?.toLowerCase().split(/[-_]/)[0] || null

// The keys under which two books count as the same work, most exact first.
// Books without an author only match by ISBN: "Poems" by two people isn't one
// book.
export function bookKeys(
  book: Pick<BookSummary, 'title' | 'authors' | 'isbn'>,
) {
  const keys: string[] = []
  const isbn = isbn13(book.isbn)
  if (isbn) keys.push(`isbn:${isbn}`)
  const title = workTitle(book.title)
  const author = book.authors[0] ? surname(book.authors[0]) : ''
  if (title && author) keys.push(`work:${title}|${author}`)
  return keys
}

// Interleaves each source's ranked list (1st of each, then 2nd of each...).
function interleave<T>(lists: Array<SourceResults<T>>) {
  const out: Array<{ list: SourceResults<T>; item: T }> = []
  const longest = Math.max(0, ...lists.map((l) => l.items.length))
  for (let i = 0; i < longest; i++) {
    for (const list of lists) {
      if (i < list.items.length) out.push({ list, item: list.items[i] })
    }
  }
  return out
}

// How well a book matches a search: the same title first, then the share of
// the query's words in its title and authors, then whether several sources
// have it.
function relevance(book: MergedBook, query: string) {
  const words = new Set(norm(query).split(' ').filter(Boolean))
  const text = new Set(norm([book.title, ...book.authors].join(' ')).split(' '))
  const found = [...words].filter((w) => text.has(w)).length
  return (
    (workTitle(book.title) === workTitle(query) ? 2 : 0) +
    found / Math.max(1, words.size) +
    (new Set(book.offers.map((o) => o.source)).size > 1 ? 0.25 : 0)
  )
}

// Appends each source's books to `existing`, merging a book into an earlier
// one with a shared key, including copies from the same source (catalogs
// such as Z-Library list many uploads of one book). With a `query`, the new
// books are sorted by how well they match it.
export function mergeBooks(
  existing: MergedBook[],
  lists: Array<SourceResults<BookSummary>>,
  query?: string,
) {
  const merged = existing.map((b) => ({ ...b, offers: [...b.offers] }))
  const keys = merged.map((b) => new Set(bookKeys(b)))
  // Each new book's rank: the position of its best-ranked copy.
  const rank = new Map<MergedBook, number>()
  const items = interleave(lists).map((entry, position) => ({
    ...entry,
    position,
    keys: bookKeys(entry.item),
  }))
  // Books with an ISBN first, so an exact ISBN match is found before a later
  // book's title and author claim the copy.
  const ordered = [
    ...items.filter((i) => i.keys[0]?.startsWith('isbn:')),
    ...items.filter((i) => !i.keys[0]?.startsWith('isbn:')),
  ]
  for (const { list, item, position, keys: itemKeys } of ordered) {
    if (
      merged.some((b) =>
        b.offers.some((o) => o.source === list.source && o.id === item.id),
      )
    ) {
      continue
    }
    const offer = {
      source: list.source,
      sourceName: list.sourceName,
      id: item.id,
      rating: item.rating ?? null,
    }
    const candidate = (b: MergedBook) =>
      !(
        lang(b.language) &&
        lang(item.language) &&
        lang(b.language) !== lang(item.language)
      )
    let index = -1
    for (const key of itemKeys) {
      index = merged.findIndex((b, i) => candidate(b) && keys[i].has(key))
      if (index >= 0) break
    }
    if (index < 0) {
      const book = {
        title: item.title,
        authors: item.authors,
        coverUrl: item.coverUrl,
        isbn: item.isbn ?? null,
        language: item.language ?? null,
        offers: [offer],
      }
      merged.push(book)
      keys.push(new Set(itemKeys))
      rank.set(book, position)
      continue
    }
    const book = merged[index]
    book.offers.push(offer)
    book.coverUrl ??= item.coverUrl
    book.isbn ??= item.isbn ?? null
    book.language ??= item.language ?? null
    for (const key of itemKeys) keys[index].add(key)
    if (rank.has(book)) rank.set(book, Math.min(rank.get(book)!, position))
  }
  // Offers in rank order too (copies from earlier pages first). Then each
  // source's best-rated copy takes that source's first slot; ratings from
  // different stores aren't comparable, so sources keep their order.
  const at = new Map(
    items.map((i) => [`${i.list.source}:${i.item.id}`, i.position]),
  )
  for (const book of merged) {
    book.offers.sort(
      (a, b) =>
        (at.get(`${a.source}:${a.id}`) ?? -1) -
        (at.get(`${b.source}:${b.id}`) ?? -1),
    )
    const best = [...book.offers].sort(
      (a, b) => (b.rating ?? -1) - (a.rating ?? -1),
    )
    book.offers = book.offers.map(
      (o) =>
        best.splice(
          best.findIndex((c) => c.source === o.source),
          1,
        )[0],
    )
  }
  // Earlier pages stay put; new books follow, best match first, then in rank
  // order.
  const added = merged.slice(existing.length)
  const score = new Map(added.map((b) => [b, query ? relevance(b, query) : 0]))
  return [
    ...merged.slice(0, existing.length),
    ...added.sort(
      (a, b) => score.get(b)! - score.get(a)! || rank.get(a)! - rank.get(b)!,
    ),
  ]
}

// Merges shelves (and home rows) with the same name, or the same kind,
// across sources.
export function mergeShelves(
  lists: Array<SourceResults<ShelfLink & { kind?: RowKind }>>,
) {
  const merged: Array<MergedShelf & { key: string }> = []
  for (const { list, item } of interleave(lists)) {
    const key = item.kind ?? norm(item.title)
    const shelf = merged.find(
      (s) => s.key === key && !s.refs.some((r) => r.source === list.source),
    )
    const ref = { source: list.source, id: item.id }
    if (shelf) {
      shelf.refs.push(ref)
      shelf.description ??= item.description
    } else {
      merged.push({
        key,
        title: item.title,
        description: item.description,
        refs: [ref],
      })
    }
  }
  return merged.map(({ key: _, ...shelf }) => shelf)
}

// One home from every source's: rows with the same name merge, as do
// shelves. A work merges across all rows, so it is the same entry (with the
// same offers) wherever it appears.
export function mergeHome(
  homes: Array<{
    source: number
    sourceName: string
    rows: Home['rows']
    shelves: ShelfLink[]
  }>,
) {
  const works = mergeBooks(
    [],
    homes.map((h) => ({ ...h, items: h.rows.flatMap((r) => r.books) })),
  )
  const rows = mergeShelves(homes.map((h) => ({ ...h, items: h.rows }))).map(
    (row) => {
      const lists = row.refs.map((ref) => {
        const home = homes.find((h) => h.source === ref.source)!
        return {
          ...home,
          items: home.rows.find((r) => r.id === ref.id)?.books ?? [],
        }
      })
      const books = new Set<MergedBook>()
      for (const { list, item } of interleave(lists)) {
        books.add(
          works.find((b) =>
            b.offers.some((o) => o.source === list.source && o.id === item.id),
          )!,
        )
      }
      return { ...row, books: [...books] }
    },
  )
  const shelves = mergeShelves(homes.map((h) => ({ ...h, items: h.shelves })))
  return { rows, shelves }
}
