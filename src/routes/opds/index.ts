import { createFileRoute } from '@tanstack/react-router'

import {
  ACQUISITION,
  NAVIGATION,
  feed,
  navigationEntry,
  deniedResponse,
} from '#/lib/opds-feed'

// OPDS catalog root: add <server>/opds to a reading app, signing in with a
// Bookserve username and password.
export const Route = createFileRoute('/opds/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const denied = await deniedResponse(request)
        if (denied) return denied
        return feed({
          id: 'urn:bookserve:root',
          title: 'Bookserve',
          type: NAVIGATION,
          links: [{ rel: 'self', href: '/opds', type: NAVIGATION }],
          entries: [
            navigationEntry({
              id: 'urn:bookserve:new',
              title: 'Recently added',
              href: '/opds/books?sort=new',
              type: ACQUISITION,
            }),
            navigationEntry({
              id: 'urn:bookserve:all',
              title: 'All books',
              href: '/opds/books',
              type: ACQUISITION,
            }),
          ],
        })
      },
    },
  },
})
