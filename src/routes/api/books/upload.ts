import { createFileRoute } from '@tanstack/react-router'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'

import { auth } from '#/lib/auth'
import { UploadError, uploadBook } from '#/lib/scanner'

// POST /api/books/upload?name=<file name>, with the raw EPUB as the body (one
// file per request), so it streams to disk instead of being parsed as a form.
export const Route = createFileRoute('/api/books/upload')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await auth.api.getSession({ headers: request.headers })
        if (!session) return new Response('Unauthorized', { status: 401 })
        if (session.user.role !== 'admin') {
          return new Response('Forbidden', { status: 403 })
        }
        const name = new URL(request.url).searchParams.get('name') ?? ''
        if (!/\.epub$/i.test(name) || !request.body) {
          return new Response('Only EPUB files can be uploaded', {
            status: 400,
          })
        }
        try {
          return Response.json(
            await uploadBook(
              name,
              request.body as WebReadableStream<Uint8Array>,
            ),
          )
        } catch (err) {
          if (err instanceof UploadError) {
            return new Response(err.message, { status: 400 })
          }
          console.error('[upload] Failed:', err)
          return new Response('Upload failed', { status: 500 })
        }
      },
    },
  },
})
