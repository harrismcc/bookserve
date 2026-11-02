import type { BookSummary, ShelfLink } from '#/lib/market/sdk'

// Merges results from several sources into one list, deduplicating books
// that are the same work. Client-safe, so "Load more" merges the same way.

// A source's id for a book or shelf.
export type SourceRef = { source: number; id: string }

export type Offer = SourceRef & { sourceName: string }

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

const fold = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

// "The Adventures of Sherlock Holmes: Illustrated" → "adventures of sherlock holmes"
function workTitle(title: string) {
  return fold(title)
    .split(/\s*[:;([]\s*|\s+-{1,2}\s+/)[0]
    .replace(/&/g, ' and ')
    .replace(/^(the|a|an)\s+/, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

// "Jane Austen" → "austen"; "Austen, Jane" → "austen".
function surname(author: string) {
  const name = fold(author)
  const last = name.includes(',')
    ? name.split(',')[0]
    : name.split(/\s+/).at(-1)
  return (last ?? '').replace(/[^\p{L}\p{N}]+/gu, '')
}

function isbn13(isbn: string | null | undefined) {
  const digits = (isbn ?? '').replace(/[^\dX]/gi, '').toUpperCase()
  if (digits.length === 13) return digits
  if (digits.length !== 10) return null
  const core = `978${digits.slice(0, 9)}`
  const sum = [...core].reduce(
    (total, d, i) => total + Number(d) * (i % 2 ? 3 : 1),
    0,
  )
  return core + ((10 - (sum % 10)) % 10)
}

// The keys under which two books count as the same work. Books without an
// author only match by ISBN: "Poems" by two people isn't one book.
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

// Appends each source's books to `existing`, merging a book into an earlier
// one with a shared key, unless that one already has a copy from the same
// source (then they are different editions and stay apart).
export function mergeBooks(
  existing: MergedBook[],
  lists: Array<SourceResults<BookSummary>>,
) {
  const merged = existing.map((b) => ({ ...b, offers: [...b.offers] }))
  const keys = merged.map((b) => new Set(bookKeys(b)))
  for (const { list, item } of interleave(lists)) {
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
    }
    const itemKeys = bookKeys(item)
    const index = merged.findIndex(
      (b, i) =>
        !b.offers.some((o) => o.source === list.source) &&
        itemKeys.some((k) => keys[i].has(k)),
    )
    if (index < 0) {
      merged.push({
        title: item.title,
        authors: item.authors,
        coverUrl: item.coverUrl,
        isbn: item.isbn ?? null,
        offers: [offer],
      })
      keys.push(new Set(itemKeys))
      continue
    }
    const book = merged[index]
    book.offers.push(offer)
    book.coverUrl ??= item.coverUrl
    book.isbn ??= item.isbn ?? null
    for (const key of itemKeys) keys[index].add(key)
  }
  return merged
}

// Merges shelves (and home rows) with the same name across sources.
export function mergeShelves(lists: Array<SourceResults<ShelfLink>>) {
  const merged: MergedShelf[] = []
  for (const { list, item } of interleave(lists)) {
    const name = fold(item.title)
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
    const shelf = merged.find(
      (s) =>
        fold(s.title)
          .replace(/[^\p{L}\p{N}]+/gu, ' ')
          .trim() === name && !s.refs.some((r) => r.source === list.source),
    )
    const ref = { source: list.source, id: item.id }
    if (shelf) {
      shelf.refs.push(ref)
      shelf.description ??= item.description
    } else {
      merged.push({
        title: item.title,
        description: item.description,
        refs: [ref],
      })
    }
  }
  return merged
}

// One home from every source's: rows with the same name merge, as do
// shelves. A work merges across all rows, so it is the same entry (with the
// same offers) wherever it appears.
export function mergeHome(
  homes: Array<{
    source: number
    sourceName: string
    rows: Array<ShelfLink & { books: BookSummary[] }>
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
