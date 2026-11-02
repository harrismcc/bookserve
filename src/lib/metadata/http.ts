// Outbound requests to metadata providers. Every request has a timeout, so a
// slow or offline provider fails on its own instead of hanging the match flow.

const USER_AGENT = 'Bookserve/1.0 (self-hosted ebook server)'
const TIMEOUT_MS = 8_000
const COVER_TIMEOUT_MS = 15_000
const MAX_COVER_BYTES = 10 * 1024 * 1024

export class HttpError extends Error {
  constructor(public status: number) {
    super(`Request failed (HTTP ${status})`)
  }
}

export async function request(
  url: string,
  timeoutMs: number,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string | URLSearchParams
  },
) {
  try {
    return await fetch(url, {
      method: init?.method,
      body: init?.body,
      headers: { ...init?.headers, 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw new Error(
      err instanceof Error && err.name === 'TimeoutError'
        ? 'Timed out'
        : 'Could not connect',
    )
  }
}

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await request(url, TIMEOUT_MS)
  if (!res.ok) throw new HttpError(res.status)
  try {
    return (await res.json()) as T
  } catch {
    throw new Error('Invalid response')
  }
}

const SIGNATURES: Array<{ ext: string; matches: (b: Uint8Array) => boolean }> =
  [
    {
      ext: 'jpg',
      matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    },
    {
      ext: 'png',
      matches: (b) =>
        b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
    },
    {
      ext: 'webp',
      matches: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP',
    },
  ]

const ascii = (b: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...b.subarray(start, end))

// Downloads a cover image (jpeg/png/webp only, checked by content type and by
// magic bytes; at most 10 MB). Returns the bytes and a file extension.
export async function downloadCover(url: string) {
  if (!/^https?:\/\//i.test(url)) throw new Error('Invalid cover URL')
  const res = await request(url, COVER_TIMEOUT_MS)
  if (!res.ok || !res.body) throw new HttpError(res.status)
  const type = res.headers.get('content-type') ?? ''
  if (!/^image\/(jpeg|png|webp)\b/i.test(type)) {
    throw new Error('Cover is not a JPEG, PNG or WebP image')
  }
  if (Number(res.headers.get('content-length')) > MAX_COVER_BYTES) {
    throw new Error('Cover is too large')
  }

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read().catch(() => {
      throw new Error('Cover download failed')
    })
    if (done) break
    size += value.byteLength
    if (size > MAX_COVER_BYTES) {
      await reader.cancel().catch(() => {})
      throw new Error('Cover is too large')
    }
    chunks.push(value)
  }

  const data = Buffer.concat(chunks)
  const ext = SIGNATURES.find((s) => s.matches(data))?.ext
  if (!ext) throw new Error('Cover is not a JPEG, PNG or WebP image')
  return { data, ext }
}
