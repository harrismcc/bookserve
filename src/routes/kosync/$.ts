import { createFileRoute } from '@tanstack/react-router'
import { and, eq } from 'drizzle-orm'

import { db } from '#/db'
import { readingProgress } from '#/db/schema'
import { apiKeyUser } from '#/lib/auth'
import { getSetting } from '#/lib/settings'

// KOSync, the protocol of KOReader's Progress sync plugin: set
// <server>/kosync as its custom sync server and sign in with a Bookserve
// username and an API key. Behavior follows koreader-sync-server; see
// https://github.com/pid1/kosync-conformance/blob/main/SPEC.md.
export const Route = createFileRoute('/kosync/$')({
  server: {
    handlers: {
      ANY: async ({ request, params }) => {
        if (!getSetting('kosyncEnabled')) {
          // Not a 401, so readers keep their credentials and resume once
          // sync is back on.
          return error(503, 2000, 'Progress sync is turned off on this server.')
        }
        const route = `${request.method} /${params._splat ?? ''}`
        if (route === 'POST /users/create') {
          // Accounts are Bookserve users. The client shows this message.
          return error(
            402,
            2005,
            'Registration is disabled. Sign in with your Bookserve username and an API key.',
          )
        }
        const user = apiKeyUser(
          request.headers.get('x-auth-user') ?? '',
          request.headers.get('x-auth-key') ?? '',
        )
        if (route === 'GET /users/auth') {
          return user ? Response.json({ authorized: 'OK' }) : unauthorized()
        }
        if (route === 'PUT /syncs/progress') {
          return user ? putProgress(user.id, request) : unauthorized()
        }
        const get = /^GET \/syncs\/progress\/([^/]+)$/.exec(route)
        if (get) return user ? getProgress(user.id, get[1]) : unauthorized()
        return Response.json({ message: 'Not found' }, { status: 404 })
      },
    },
  },
})

// Errors are `{ code, message }`. Clients retry anything but a 401 for weeks,
// so only bad credentials get one.
const error = (status: number, code: number, message: string) =>
  Response.json({ code, message }, { status })

const unauthorized = () => error(401, 2001, 'Unauthorized')

// Document ids are 32-char hex digests in practice; only ids that GET can
// serve are stored.
const isDocumentId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(value)

// KOReader's optional `metadata` ("Send document metadata"): the file name,
// title and authors. Only those string fields are kept, or null if none.
function documentMetadata(value: unknown) {
  if (typeof value !== 'object' || value === null) return null
  const metadata: Record<string, string> = {}
  for (const key of ['filename', 'title', 'authors'] as const) {
    const field = (value as Record<string, unknown>)[key]
    if (typeof field === 'string' && field.trim()) {
      metadata[key] = field.trim().slice(0, 500)
    }
  }
  return Object.keys(metadata).length > 0 ? metadata : null
}

// A reader pushes its position. The last write wins; the client resolves
// conflicts with the server's timestamp.
async function putProgress(userId: string, request: Request) {
  const body: Record<string, unknown> | null = await request
    .json()
    .catch(() => null)
  if (!isDocumentId(body?.document)) {
    return error(403, 2004, "Field 'document' not provided.")
  }
  const { percentage, progress, device } = body
  if (
    typeof percentage !== 'number' ||
    !Number.isFinite(percentage) ||
    (typeof progress !== 'string' && typeof progress !== 'number') ||
    typeof device !== 'string' ||
    !device
  ) {
    return error(403, 2003, 'Invalid request')
  }
  const now = new Date(Math.floor(Date.now() / 1000) * 1000)
  const metadata = documentMetadata(body.metadata)
  const fields = {
    progress: String(progress),
    percentage,
    device,
    deviceId: typeof body.device_id === 'string' ? body.device_id : null,
    ...(metadata && { metadata }),
    updatedAt: now,
  }
  db.insert(readingProgress)
    .values({ userId, document: body.document, ...fields })
    .onConflictDoUpdate({
      target: [readingProgress.userId, readingProgress.document],
      set: fields,
    })
    .run()
  return Response.json({
    document: body.document,
    timestamp: now.getTime() / 1000,
  })
}

// A reader pulls the last position. An unknown document is `200 {}`: the
// client checks for a missing `percentage`, not the status.
function getProgress(userId: string, document: string) {
  if (!isDocumentId(document)) {
    return error(403, 2004, "Field 'document' not provided.")
  }
  const row = db
    .select()
    .from(readingProgress)
    .where(
      and(
        eq(readingProgress.userId, userId),
        eq(readingProgress.document, document),
      ),
    )
    .get()
  if (!row) return Response.json({})
  return Response.json({
    document: row.document,
    percentage: row.percentage,
    progress: row.progress,
    device: row.device,
    ...(row.deviceId != null && { device_id: row.deviceId }),
    timestamp: row.updatedAt.getTime() / 1000,
  })
}
