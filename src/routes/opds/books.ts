import { createFileRoute } from '@tanstack/react-router'
import { desc, eq } from 'drizzle-orm'

import { db } from '#/db'
import { books } from '#/db/schema'
import { requestUser, unauthorized } from '#/lib/auth'
import { bookView } from '#/lib/books'
import { ACQUISITION, bookEntry, feed } from '#/lib/opds-feed'

const PAGE_SIZE = 50
const collator = new Intl.Collator()

// Acquisition feed of the books whose files are present:
// ?sort=new for recently added (default: by title), ?q= to search, ?page=.
export const Route = createFileRoute('/opds/books')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await requestUser(request))) return unauthorized()
        const params = new URL(request.url).searchParams
        const recent = params.get('sort') === 'new'
        const query = params.get('q')?.trim() ?? ''
        const words = query.toLowerCase().split(/\s+/).filter(Boolean)

        let list = db
          .select()
          .from(books)
          .where(eq(books.missing, false))
          .orderBy(desc(books.createdAt))
          .all()
          .map(bookView)
        // Every word must appear in the title, an author, the series or the ISBN.
        if (words.length) {
          list = list.filter((book) => {
            const fields = [book.title, ...book.authors, book.series, book.isbn]
              .filter(Boolean)
              .join('\n')
              .toLowerCase()
            return words.every((word) => fields.includes(word))
          })
        }
        if (!recent)
          list.sort((a, b) => collator.compare(a.sortTitle, b.sortTitle))

        const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE))
        const page = Math.min(
          pages,
          Math.max(1, Number.parseInt(params.get('page') ?? '', 10) || 1),
        )
        const pageUrl = (n: number) => {
          const url = new URLSearchParams()
          if (recent) url.set('sort', 'new')
          if (query) url.set('q', query)
          if (n > 1) url.set('page', String(n))
          const search = url.toString()
          return `/opds/books${search ? `?${search}` : ''}`
        }
        const links = [
          { rel: 'self', href: pageUrl(page), type: ACQUISITION },
          { rel: 'first', href: pageUrl(1), type: ACQUISITION },
          { rel: 'last', href: pageUrl(pages), type: ACQUISITION },
        ]
        if (page > 1) {
          links.push({
            rel: 'previous',
            href: pageUrl(page - 1),
            type: ACQUISITION,
          })
        }
        if (page < pages) {
          links.push({
            rel: 'next',
            href: pageUrl(page + 1),
            type: ACQUISITION,
          })
        }

        return feed({
          id: `urn:bookserve:${query ? `search:${encodeURIComponent(query)}` : recent ? 'new' : 'all'}`,
          title: query
            ? `Search: ${query}`
            : recent
              ? 'Recently added'
              : 'All books',
          type: ACQUISITION,
          links,
          entries: list
            .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
            .map(bookEntry),
        })
      },
    },
  },
})
