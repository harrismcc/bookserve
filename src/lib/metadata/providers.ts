// Shared by the server and the match dialog: no server imports here.
// Implementations live next to this file and are registered in
// src/lib/match-functions.ts.

export const PROVIDERS = [
  { id: 'openlibrary', name: 'Open Library' },
  { id: 'google', name: 'Google Books' },
  { id: 'hardcover', name: 'Hardcover' },
] as const

export type ProviderId = (typeof PROVIDERS)[number]['id']

export type MetadataQuery = { title: string; author: string; isbn: string }

// The metadata fields a match can write into books.matched.
export type MatchFields = {
  title: string
  authors: string[]
  description: string | null
  publisher: string | null
  publishedDate: string | null
  isbn: string | null
  language: string | null
  series: string | null
  seriesIndex: number | null
  pageCount: number | null
}

export type Candidate = MatchFields & {
  provider: ProviderId
  id: string
  coverUrl: string | null
  thumbnailUrl: string | null
  // Some fields (Open Library's description) are only loaded with `details`.
  partial?: boolean
}

export type MetadataProvider = {
  // One request per search; throws an Error with a short message on failure.
  search: (query: MetadataQuery) => Promise<Candidate[]>
  // Fills in what `search` leaves out, for the candidate the user picked.
  details?: (id: string) => Promise<Partial<MatchFields>>
}

export const providerName = (id: ProviderId) =>
  PROVIDERS.find((p) => p.id === id)?.name ?? id
