import path from 'node:path'
import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'

import { db } from '#/db'
import { bookFiles } from '#/db/schema'
import { auth } from '#/lib/auth'
import { fileResponse, resolveInside } from '#/lib/books'
import { config } from '#/lib/config'

export const Route = createFileRoute('/api/books/$bookId/download')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!(await auth.api.getSession({ headers: request.headers }))) {
          return new Response('Unauthorized', { status: 401 })
        }
        const row = db
          .select()
          .from(bookFiles)
          .where(eq(bookFiles.bookId, params.bookId))
          .get()
        const file = row ? resolveInside(config.libraryDir, row.path) : null
        const name = path.basename(file ?? '')
        const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, '_')
        return fileResponse(file, {
          'content-type': 'application/epub+zip',
          'content-disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`,
          'cache-control': 'private, no-cache',
        })
      },
    },
  },
})
