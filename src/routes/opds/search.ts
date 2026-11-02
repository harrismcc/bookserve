import { createFileRoute } from '@tanstack/react-router'

import { requestUser, unauthorized } from '#/lib/auth'
import { ACQUISITION, OPENSEARCH, publicOrigin, xml } from '#/lib/opds-feed'

// OpenSearch description for the catalog's rel="search" link.
export const Route = createFileRoute('/opds/search')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await requestUser(request))) return unauthorized()
        const template = `${publicOrigin(request)}/opds/books?q={searchTerms}`
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
<ShortName>Bookserve</ShortName>
<Description>Search the library</Description>
<InputEncoding>UTF-8</InputEncoding>
<OutputEncoding>UTF-8</OutputEncoding>
<Url type="${ACQUISITION}" template="${xml(template)}"/>
</OpenSearchDescription>
`,
          {
            headers: {
              'content-type': `${OPENSEARCH};charset=utf-8`,
              'cache-control': 'private, no-cache',
            },
          },
        )
      },
    },
  },
})
