# Market integrations

The Market lets admins browse online catalogs and add books to the library. Each catalog type is an **integration**: a small module that fetches the catalog and maps it into Bookserve's types. Bookserve owns everything else: the store UI, caching, validation, downloading, EPUB checks, provenance and metadata.

An admin adds **sources** in Settings → Market sources. A source is an integration plus its settings (for example, an OPDS catalog URL and credentials), with its own id. Books added from a source are linked to it in `book_sources`.

Built-in integrations:

- `gutenberg`: Project Gutenberg (`src/lib/market/integrations/gutenberg.ts`). Seeded as the default source.
- `opds`: any OPDS 1.x catalog (`src/lib/market/integrations/opds.ts`).
- `z-library`: Z-Library (`src/lib/market/integrations/z-library.ts`), through the unofficial EAPI its Android app uses. Needs the account's mirror URL; browsing works logged out, while adding books needs either account credentials or the `remix_userid`/`remix_userkey` session cookies. Some mirrors sit behind bot protection and cannot answer the API; prefer one that returns JSON from `/eapi/info`.

## Goals

- **One Market, many stores.** Users see a single store: one search, one home, one book page. Each source's books appear in it as the same cards, merged with copies from other sources. A new store adds books to the Market; it does not add a new page or feature.
- **All store-specific code lives in its integration.** Quirks of a catalog (odd feeds, auth, id formats, missing fields) are handled there, so the rest of Bookserve never knows which store a book came from.
- **Anyone can write one.** The contract in `sdk.ts` is small and stable enough that a third party can write an integration without reading the rest of the codebase. Integrations will later be loadable from `<data>/plugins/`, so the built-in ones must follow the same rules.

## Where code goes

| Code                                                                                | Lives in                                                                                                |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Talking to a store: fetching, parsing, auth, mapping to `BookSummary`/`BookDetails` | `src/lib/market/integrations/<id>.ts`                                                                   |
| The contract and helpers integrations may use                                       | `src/lib/market/sdk.ts`                                                                                 |
| Running integrations: context, cache, timeouts, cleaning their output               | `src/lib/market/host.ts`                                                                                |
| Merging sources: deduplication, rows, shelves                                       | `src/lib/market/merge.ts`                                                                               |
| Server functions: sources, browsing, adding to the library                          | `src/lib/market-functions.ts`                                                                           |
| UI                                                                                  | `src/routes/_app/market.tsx`, `src/routes/_app/market_.book.tsx`, `src/routes/_app/settings/market.tsx` |

Never:

- Check which integration or source something came from outside its integration (no `if (integration.id === 'gutenberg')` in the host, server functions, merge code or UI).
- Add a store-specific route, server function, table, setting screen or UI branch.
- Import Bookserve modules other than `#/lib/market/sdk` from an integration, or use `fetch`, the database or the filesystem directly.

When an integration needs something the contract lacks (a field, a capability, a kind of setting), extend `sdk.ts` for every integration: an optional field or method that the host and UI handle generically. If an existing integration would break, bump `apiVersion`. If the store speaks standard OPDS, use the `opds` integration instead of writing a new one; write a bespoke one only when its catalog needs smoothing over, as Gutenberg's does.

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

The Market shows every source at once, merging the same book from different sources into one entry, and home rows or shelves with the same title into one. Books merge on ISBN, or on title (up to any `:`, `;`, `(`, `[`, `-` or `--`) plus the first author's surname, never across languages. Copies from the same source merge too, so a catalog's many uploads of one book show as one entry. Set `isbn` and `language` on a `BookSummary` when the catalog has them. Set `rating` (0–5) when users rate the store's copies; among one source's copies of a book, the best-rated is offered first.

## Rules

- **Ids are yours.** Book, shelf, format ids and cursors are opaque strings that Bookserve passes back unchanged. Book ids must be stable: they are stored in `book_sources.external_id` to show "In library" and to avoid adding a book twice. They arrive from the browser, so validate them before building URLs (see `catalogPath` in the Gutenberg integration).
- **Use `ctx.fetch`**, not `fetch`: it takes `method`, `headers`, `body` and `timeoutMs`, allows only http(s) URLs, adds a timeout and Bookserve's User-Agent, and throws on network errors and non-2xx responses with a message the UI shows as is. Set `allowErrorStatus` when a store answers errors with a useful body; check `res.ok` yourself. Throw an `Error` with a short message for anything else ("Unknown book").
- **Use `ctx.cached(key, ttlMs, load)`** for anything `book()` and `download()` refetch. Its cache is per source and in memory.
- **Return plain data.** Text is plain (no HTML; the SDK's `htmlToText` converts). Dates are `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. Cover URLs are http(s). Bookserve trims and drops anything malformed (`src/lib/market/host.ts`), so a buggy integration can't break the page.
- **EPUB only.** List only EPUB formats; return an empty `formats` list for books without one. The download is checked to be a valid EPUB before it is added.
- **Don't fill in metadata you don't have.** When a book is added, its EPUB's own metadata wins; the integration's description, language, publisher, date, ISBN and cover only fill gaps (stored as a match in `books.matched`, so "Revert to file metadata" removes them).
- **Trust.** Integrations run in the server process with full access, so only add code you trust. Settings of type `password` are never sent to the browser.
- **Versioning.** `apiVersion` is `1`. A breaking change to the SDK bumps it, and integrations with another version are not loaded.
