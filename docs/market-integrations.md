# Market integrations

The Market lets admins browse online catalogs and add books to the library. Each catalog type is an **integration**: a small module that fetches the catalog and maps it into Bookserve's types. Bookserve owns everything else: the store UI, caching, validation, downloading, EPUB checks, provenance and metadata.

An admin adds **sources** in Settings → Market sources. A source is an integration plus its settings (for example, an OPDS catalog URL and credentials), with its own id. Books added from a source are linked to it in `book_sources`.

Built-in integrations:

- `gutenberg`: Project Gutenberg (`src/lib/market/integrations/gutenberg.ts`). Seeded as the default source.
- `opds`: any OPDS 1.x catalog (`src/lib/market/integrations/opds.ts`).

## Writing an integration

An integration is a `MarketIntegration` object from `src/lib/market/sdk.ts`. Import only from that module: it also exports the helpers integrations need (`parseFeed`, `parseOpenSearch`, `fillSearchTemplate` and `resolveUrl` for OPDS feeds, `htmlToText`).

```ts
import { defineIntegration } from '#/lib/market/sdk'

export const example = defineIntegration({
  id: 'example', // stored on sources and book_sources; never change it
  name: 'Example Books',
  apiVersion: 1,
  // Fields the admin fills in when adding a source; read them from ctx.settings.
  settings: [
    { key: 'apiKey', label: 'API key', type: 'password', required: true },
  ],

  // Optional: called when a source is added. Throw to reject the settings.
  async check(ctx) {
    await ctx.fetch('https://example.com/api/me', { headers: auth(ctx) })
  },

  // The landing page: rows of books, and shelves (categories) to browse.
  async home(ctx) {
    return {
      // `kind` ('popular' or 'new') merges the row with other sources' rows
      // of that kind; rows without one merge by title.
      rows: [
        {
          id: 'popular',
          kind: 'popular',
          title: 'Popular',
          description: null,
          books: [],
        },
      ],
      shelves: [{ id: 'fiction', title: 'Fiction', description: null }],
    }
  },

  // A shelf, row or any id you returned in a ShelfLink; `cursor` is the
  // nextCursor you returned for the previous page.
  async shelf(ctx, shelfId, cursor) {
    return { title: 'Fiction', shelves: [], books: [], nextCursor: null }
  },

  // Optional; without it there is no search box.
  async search(ctx, query, cursor) {
    return { title: query, shelves: [], books: [], nextCursor: null }
  },

  async book(ctx, bookId) {
    return {
      id: bookId,
      title: '…',
      authors: ['…'],
      coverUrl: null,
      description: null,
      language: 'en',
      publisher: null,
      publishedDate: null,
      isbn: null,
      subjects: [],
      shelves: [], // related shelves: the author, series, categories
      formats: [{ id: 'epub', label: 'EPUB', size: null }], // EPUB only, best first
    }
  },

  // The EPUB file. Bookserve streams the body into the library; ctx.fetch
  // gets a longer timeout here.
  async download(ctx, bookId, formatId) {
    return ctx.fetch(`https://example.com/books/${bookId}.epub`, {
      headers: auth(ctx),
    })
  },
})
```

Then register it in `INTEGRATIONS` in `src/lib/market/host.ts`. It shows up in the "Add source" dialog, with a form built from `settings`.

The Market shows every source at once, merging the same book from different sources into one entry, and home rows or shelves with the same title into one. Books merge on ISBN, or on title (up to any `:`, `;`, `(`, `[`, `-` or `--`) plus the first author's surname, never across languages. Set `isbn` and `language` on a `BookSummary` when the catalog has them.

## Rules

- **Ids are yours.** Book, shelf, format ids and cursors are opaque strings that Bookserve passes back unchanged. Book ids must be stable: they are stored in `book_sources.external_id` to show "In library" and to avoid adding a book twice. They arrive from the browser, so validate them before building URLs (see `catalogPath` in the Gutenberg integration).
- **Use `ctx.fetch`**, not `fetch`: it takes `method`, `headers`, `body` and `timeoutMs`, allows only http(s) URLs, adds a timeout and Bookserve's User-Agent, and throws on network errors and non-2xx responses with a message the UI shows as is. Throw an `Error` with a short message for anything else ("Unknown book").
- **Use `ctx.cached(key, ttlMs, load)`** for anything `book()` and `download()` refetch. Its cache is per source and in memory.
- **Return plain data.** Text is plain (no HTML; `htmlToText` from `#/lib/epub` converts). Dates are `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. Cover URLs are http(s). Bookserve trims and drops anything malformed (`src/lib/market/host.ts`), so a buggy integration can't break the page.
- **EPUB only.** List only EPUB formats; return an empty `formats` list for books without one. The download is checked to be a valid EPUB before it is added.
- **Don't fill in metadata you don't have.** When a book is added, its EPUB's own metadata wins; the integration's description, language, publisher, date, ISBN and cover only fill gaps (stored as a match in `books.matched`, so "Revert to file metadata" removes them).
- **Trust.** Integrations run in the server process with full access, so only add code you trust. Settings of type `password` are never sent to the browser.
- **Versioning.** `apiVersion` is `1`. A breaking change to the SDK bumps it, and integrations with another version are not loaded.
