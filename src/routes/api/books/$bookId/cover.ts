import path from 'node:path'
import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'

import { db } from '#/db'
import { books } from '#/db/schema'
import { auth } from '#/lib/auth'
import { bookView, fileResponse, resolveInside } from '#/lib/books'
import { config } from '#/lib/config'

const TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

export const Route = createFileRoute('/api/books/$bookId/cover')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!(await auth.api.getSession({ headers: request.headers }))) {
          return new Response('Unauthorized', { status: 401 })
        }
        const row = db
          .select()
          .from(books)
          .where(eq(books.id, params.bookId))
          .get()
        const coverPath = row ? bookView(row).coverPath : null
        const file = coverPath ? resolveInside(config.dataDir, coverPath) : null
        return fileResponse(file, {
          'content-type':
            TYPES[path.extname(file ?? '')] ?? 'application/octet-stream',
          // Cover URLs are versioned with the book's update time (?v=).
          'cache-control': 'private, max-age=31536000, immutable',
        })
      },
    },
  },
})
