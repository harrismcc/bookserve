import { defineIntegration, htmlToText, resolveUrl } from '#/lib/market/sdk'
import type {
  BookDetails,
  BookSummary,
  IntegrationContext,
  Listing,
  ShelfLink,
} from '#/lib/market/sdk'

// Z-Library through the EAPI its Android app uses. There is no official API
// and no single domain: mirrors appear and disappear, and downloads work on
// the account's personal domain, so the admin supplies the mirror. Requests
// authenticate with the remix_userid/remix_userkey pair, either given directly
// (copied from the browser's cookies) or obtained by signing in.
//
// Book ids are `<id>:<hash>`; both are required by every book endpoint.

const CACHE_MS = 5 * 60_000
const SESSION_MS = 30 * 60_000
const PAGE_SIZE = 20

const ROWS = [
  {
    id: 'popular',
    kind: 'popular' as const,
    title: 'Popular',
    path: '/eapi/book/most-popular',
  },
  {
    id: 'recent',
    kind: 'new' as const,
    title: 'Recently added',
    path: '/eapi/book/recently',
  },
]

// EAPI sends language names; merge and metadata want ISO 639 codes.
const LANGUAGES: Record<string, string> = {
  afrikaans: 'af',
  albanian: 'sq',
  arabic: 'ar',
  armenian: 'hy',
  azerbaijani: 'az',
  basque: 'eu',
  bengali: 'bn',
  bulgarian: 'bg',
  catalan: 'ca',
  chinese: 'zh',
  croatian: 'hr',
  czech: 'cs',
  danish: 'da',
  dutch: 'nl',
  english: 'en',
  esperanto: 'eo',
  estonian: 'et',
  finnish: 'fi',
  french: 'fr',
  galician: 'gl',
  georgian: 'ka',
  german: 'de',
  greek: 'el',
  hebrew: 'he',
  hindi: 'hi',
  hungarian: 'hu',
  icelandic: 'is',
  indonesian: 'id',
  irish: 'ga',
  italian: 'it',
  japanese: 'ja',
  kazakh: 'kk',
  korean: 'ko',
  latin: 'la',
  latvian: 'lv',
  lithuanian: 'lt',
  macedonian: 'mk',
  malay: 'ms',
  norwegian: 'no',
  persian: 'fa',
  polish: 'pl',
  portuguese: 'pt',
  romanian: 'ro',
  russian: 'ru',
  serbian: 'sr',
  slovak: 'sk',
  slovenian: 'sl',
  spanish: 'es',
  swedish: 'sv',
  thai: 'th',
  turkish: 'tr',
  ukrainian: 'uk',
  urdu: 'ur',
  vietnamese: 'vi',
}

type Json = Record<string, unknown>
type Credentials = { id: string; key: string }

const obj = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : {}

const text = (value: unknown) =>
  typeof value === 'string'
    ? value.trim()
    : typeof value === 'number'
      ? String(value)
      : ''

const httpUrl = (value: unknown) => {
  const url = text(value)
  return /^https?:\/\//i.test(url) ? url : null
}

function base(ctx: IntegrationContext) {
  const url = text(ctx.settings.url)
    .replace(/\/+$/, '')
    .replace(/\/eapi$/i, '')
  if (!httpUrl(url)) throw new Error('Invalid mirror URL')
  return url
}

// "Request failed (HTTP 400)" → "HTTP 400".
const reason = (err: unknown) => {
  const message = err instanceof Error ? err.message : 'Request failed'
  return message.match(/HTTP \d+/)?.[0] ?? message
}

const sessionRejected = (err: unknown) =>
  err instanceof Error &&
  /HTTP 40[013]|please login|invalid credentials/i.test(err.message)

const authHeaders = (auth: Credentials) => ({
  accept: 'application/json',
  'remix-userid': auth.id,
  'remix-userkey': auth.key,
  cookie: `remix_userid=${encodeURIComponent(auth.id)}; remix_userkey=${encodeURIComponent(auth.key)}`,
})

async function body(res: Response): Promise<Json> {
  const data = await res.json().catch(() => null)
  if (data && typeof data === 'object' && !Array.isArray(data)) return data
  throw new Error(
    res.ok ? 'Invalid response' : `Request failed (HTTP ${res.status})`,
  )
}

// Mirrors behind DiamWall answer with a redirect to themselves until fetch
// gives up, which surfaces as a plain "Could not connect".
async function reach(
  ctx: IntegrationContext,
  url: string,
  init?: Parameters<IntegrationContext['fetch']>[1],
) {
  try {
    return await ctx.fetch(url, init)
  } catch (err) {
    if (err instanceof Error && err.message === 'Could not connect') {
      throw new Error(
        'Could not connect — the mirror may be blocking API requests; try another mirror',
      )
    }
    throw err
  }
}

async function login(ctx: IntegrationContext): Promise<Credentials> {
  const email = text(ctx.settings.email)
  const password = text(ctx.settings.password)
  if (!email || !password) {
    throw new Error('Enter an email and password, or a session user id and key')
  }
  let data: Json
  try {
    const res = await reach(ctx, `${base(ctx)}/eapi/user/login`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ email, password }),
      allowErrorStatus: true,
    })
    data = await body(res)
  } catch (err) {
    throw new Error(`Sign-in failed (${reason(err)})`)
  }
  const user = obj(data.user)
  const id = text(user.id)
  const key = text(user.remix_userkey) || text(user.remix_user_key)
  if (data.success !== 1 || !id || !key) {
    throw new Error(text(data.error) || 'Sign-in failed')
  }
  return { id, key }
}

function credentials(ctx: IntegrationContext): Promise<Credentials | null> {
  const id = text(ctx.settings.remixUserId)
  const key = text(ctx.settings.remixUserKey)
  if (id && key) return Promise.resolve({ id, key })
  if (!text(ctx.settings.email) || !text(ctx.settings.password)) {
    return Promise.resolve(null)
  }
  return ctx.cached('session', SESSION_MS, () => login(ctx))
}

type Init = {
  query?: Record<string, string>
  headers?: Record<string, string>
  body?: URLSearchParams
}

// An EAPI call with auth, retried once with a fresh session when the mirror
// rejects the saved one. Without credentials, calls are anonymous.
async function request(
  ctx: IntegrationContext,
  method: string,
  path: string,
  init?: Init,
): Promise<Json> {
  const query = init?.query ? `?${new URLSearchParams(init.query)}` : ''
  const url = base(ctx) + path + query
  const send = async (auth: Credentials | null) => {
    const res = await reach(ctx, url, {
      method,
      headers: { ...(auth ? authHeaders(auth) : {}), ...init?.headers },
      body: init?.body,
      allowErrorStatus: true,
    })
    const data = await body(res)
    if (data.success !== 1) {
      throw new Error(
        text(data.error) ||
          (res.ok ? 'Request failed' : `Request failed (HTTP ${res.status})`),
      )
    }
    return data
  }
  const saved = await credentials(ctx)
  try {
    return await send(saved)
  } catch (err) {
    if (!saved || !text(ctx.settings.email) || !sessionRejected(err)) throw err
    return send(await login(ctx))
  }
}

function ref(bookId: string) {
  const match = /^(\d+):([a-z0-9]+)$/i.exec(bookId)
  if (!match) throw new Error('Unknown book')
  return {
    id: match[1],
    hash: match[2],
    path: `/eapi/book/${match[1]}/${match[2]}`,
  }
}

const authors = (value: unknown) =>
  text(value)
    .split(';')
    .map((name) => name.trim())
    .filter(Boolean)

const isbn = (book: Json) =>
  [book.identifier, book.isbn, book.isbn13, book.isbn10]
    .map(text)
    .find(Boolean)
    ?.replace(/[^\dX]/gi, '') || null

const language = (value: unknown) => {
  const name = text(value).toLowerCase()
  return LANGUAGES[name] ?? (/^[a-z]{2}$/.test(name) ? name : null)
}

function summary(ctx: IntegrationContext, book: Json): BookSummary | null {
  const id = text(book.id)
  const hash = text(book.hash)
  if (!id || !hash) return null
  return {
    id: `${id}:${hash}`,
    title: text(book.title) || 'Untitled',
    authors: authors(book.author),
    coverUrl: resolveUrl(text(book.cover), base(ctx)),
    isbn: isbn(book),
    language: language(book.language),
  }
}

const books = (ctx: IntegrationContext, list: unknown) =>
  (Array.isArray(list) ? list : []).flatMap((book) => {
    const result = summary(ctx, obj(book))
    return result ? [result] : []
  })

function nextCursor(data: Json, page: number) {
  const pagination = obj(data.pagination)
  const current = Number(pagination.current) || page
  const total = Number(pagination.total_pages) || 0
  return total > current ? String(current + 1) : null
}

async function listing(
  ctx: IntegrationContext,
  path: string,
  title: string,
  cursor: string | null,
): Promise<Listing> {
  const page = Math.max(1, Number(cursor) || 1)
  const data = await request(ctx, 'GET', path, {
    query: { page: String(page), limit: String(PAGE_SIZE) },
  })
  return {
    title,
    shelves: [],
    books: books(ctx, data.books),
    nextCursor: nextCursor(data, page),
  }
}

async function search(
  ctx: IntegrationContext,
  query: string,
  cursor: string | null,
): Promise<Listing> {
  const page = Math.max(1, Number(cursor) || 1)
  const form = new URLSearchParams({
    message: query,
    page: String(page),
    limit: String(PAGE_SIZE),
  })
  form.append('extensions[]', 'epub')
  const data = await request(ctx, 'POST', '/eapi/book/search', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
  })
  return {
    title: query,
    shelves: [],
    books: books(ctx, data.books),
    nextCursor: nextCursor(data, page),
  }
}

function subjects(book: Json) {
  const flatten = (value: unknown): string[] => {
    if (typeof value === 'string') return [value.trim()].filter(Boolean)
    if (Array.isArray(value)) return value.flatMap(flatten)
    if (value && typeof value === 'object') {
      const item = obj(value)
      return flatten(item.name ?? item.title ?? item.path)
    }
    return []
  }
  return [...flatten(book.categories), ...flatten(book.category)]
}

const size = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : null

export const zlibrary = defineIntegration({
  id: 'z-library',
  name: 'Z-Library',
  apiVersion: 1,
  settings: [
    {
      key: 'url',
      label: 'Mirror URL',
      type: 'url',
      required: true,
      placeholder: 'https://z-lib.gd',
    },
    { key: 'email', label: 'Email', type: 'text' },
    { key: 'password', label: 'Password', type: 'password' },
    {
      key: 'remixUserId',
      label: 'Session user id (optional)',
      type: 'text',
    },
    {
      key: 'remixUserKey',
      label: 'Session key (optional)',
      type: 'password',
    },
  ],

  async check(ctx) {
    await request(
      ctx,
      'GET',
      (await credentials(ctx)) ? '/eapi/user/profile' : '/eapi/info',
    )
  },

  async home(ctx) {
    const rows = await Promise.all(
      ROWS.map(async (row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        description: null,
        books: await listing(ctx, row.path, row.title, null).then(
          (l) => l.books,
          () => [],
        ),
      })),
    )
    return {
      rows,
      shelves: (await credentials(ctx))
        ? [{ id: 'saved', title: 'Saved', description: null }]
        : [],
    }
  },

  async shelf(ctx, shelfId, cursor) {
    if (shelfId === 'saved') {
      return listing(ctx, '/eapi/user/book/saved', 'Saved', cursor)
    }
    if (shelfId.startsWith('similar:')) {
      const book = ref(shelfId.slice('similar:'.length))
      const data = await request(ctx, 'GET', `${book.path}/similar`)
      return {
        title: 'Similar books',
        shelves: [],
        books: books(ctx, data.books),
        nextCursor: null,
      }
    }
    if (shelfId.startsWith('author:')) {
      const author = shelfId.slice('author:'.length)
      return search(ctx, author, cursor)
    }
    const row = ROWS.find((r) => r.id === shelfId)
    if (!row) throw new Error('Unknown shelf')
    return listing(ctx, row.path, row.title, cursor)
  },

  search,

  async book(ctx, bookId) {
    const book = ref(bookId)
    const data = await ctx.cached(book.path, CACHE_MS, () =>
      request(ctx, 'GET', book.path),
    )
    const details = obj(data.book)
    const result = summary(ctx, details)
    if (!result) throw new Error('Unknown book')
    const author = result.authors[0]
    const shelves: ShelfLink[] = []
    if (author) {
      shelves.push({ id: `author:${author}`, title: author, description: null })
    }
    shelves.push({
      id: `similar:${book.id}:${book.hash}`,
      title: 'Similar books',
      description: null,
    })
    const format = text(details.extension).toLowerCase()
    const date = text(details.year)
    return {
      ...result,
      id: bookId,
      description: text(details.description)
        ? htmlToText(text(details.description))
        : null,
      publisher: text(details.publisher) || null,
      publishedDate: /^\d{4}$/.test(date) && date !== '0000' ? date : null,
      subjects: subjects(details),
      shelves,
      formats:
        format === 'epub'
          ? [{ id: 'epub', label: 'EPUB', size: size(details.filesize) }]
          : [],
    } satisfies BookDetails
  },

  async download(ctx, bookId, formatId) {
    if (formatId !== 'epub') throw new Error('Unknown format')
    const book = ref(bookId)
    const data = await request(ctx, 'GET', `${book.path}/file`)
    const link = resolveUrl(text(obj(data.file).downloadLink), base(ctx))
    if (!link) throw new Error('No download link')
    // Personal domains need the session; CDNs elsewhere don't get it.
    const auth = await credentials(ctx)
    const headers =
      auth && new URL(link).origin === new URL(base(ctx)).origin
        ? authHeaders(auth)
        : undefined
    return ctx.fetch(link, { headers })
  },
})
