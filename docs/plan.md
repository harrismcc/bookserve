# Bookserve MVP plan

Living document. Update the status and notes for each phase as work lands, so any agent can pick up from here.

## Goal

First boot shows a setup screen that creates the admin. After that, signed-in users see their library (books on the filesystem, with metadata). An admin-only settings page manages users. Book metadata comes from the file itself, with online matching.

## Decisions (approved)

- **Login by username only.** Better Auth `username` plugin. Better Auth still requires an email, so store a synthetic `<username>@bookserve.local` and never show it.
- **Roles** via the Better Auth `admin` plugin (`admin` / `user`). Settings is admin-only, enforced on the server.
- **One library directory** for now (`BOOKSERVE_LIBRARY_DIR`), with a schema that allows more later.
- **Paths from env:** `BOOKSERVE_DATA_DIR` (SQLite DB, covers, generated secret) and `BOOKSERVE_LIBRARY_DIR`. Dev defaults live under `./data`; the container uses `/config` and `/books`.
- **Boot is self-sufficient:** create directories, run Drizzle migrations, and generate and persist the auth secret if none is set.
- **Metadata:** read embedded EPUB metadata and cover on scan. Online matching is manual (as in Audiobookshelf). Open Library comes first (no key), then Google Books (optional key). Hardcover is later and optional. Matched metadata and covers are stored in the DB and data dir, never written into book files. Priority is two layers only: embedded EPUB metadata, then matched fields on top. No sidecar files (`metadata.opf`, `metadata.json`) and no metadata parsed from folder names.
- **Dependencies for scanning:** `fflate` (unzip) + `fast-xml-parser` (OPF). Both are pure JS. EPUB first; PDF later.
- **Uploads** are saved to `<library>/<Author>/<Title>/<file>`. This is the only place the app writes into the library.

## Phases

### Phase 1 — Foundation and first-run setup — status: done

- Config module for env paths and defaults.
- Startup: create directories, run migrations, persist the generated secret.
- Better Auth wired to Drizzle (SQLite) with the `username` and `admin` plugins; auth schema in `src/db/schema.ts`; committed migration. Remove the demo `todos` table.
- `/setup` only when there are zero users: it creates the admin, then signs in. Otherwise it redirects.
- `/login`. Every app route requires a session.
- Dockerfile (multi-arch, `better-sqlite3` native build) plus a `.dockerignore`.

### Phase 2 — App shell and user management — status: done

- Layout with Library (`/`) and Settings (`/settings`) navigation, plus sign-out.
- `/settings/users` (admin only): list, add (username, password, role), change role, delete, reset password.

### Phase 3 — Library scanning and the grid view — status: done

- `books` / `book_files` tables.
- Scanner: walk the library directory for `.epub`, read OPF metadata and the cover (cached into the data dir), and handle added, moved, or removed files. Runs on startup and on demand (an admin button).
- Library grid of covers; book detail page; download/stream the file.
- Upload an EPUB into the library.

### Phase 4 — Online metadata matching — status: done

- Provider interface; Open Library and Google Books providers with timeouts (the app works offline).
- On the book detail page, "Match" searches, lists candidates, and lets the user choose fields to apply. Covers are cached on disk.

### Later

In-browser reader, OPDS, Hardcover provider, file watching, PDF metadata, multiple libraries. Series from providers (neither Open Library search nor Google Books returns a usable series name). Edit metadata by hand (the same `books.matched` overlay).

## Notes log

Append short notes here: gotchas, conventions established, verification commands.

### Phase 1

- **Config:** `src/lib/config.ts` (`dataDir`, `libraryDir`, `databasePath`, `secretPath`, `migrationsDir`, `publicUrl`). Server-only; read paths from here, never from `process.env` directly.
- **Startup:** `src/server/startup.ts` is a Nitro plugin (registered in `vite.config.ts`) that imports `#/lib/auth`, which imports `#/db`. `src/db/index.ts` creates the data and library dirs, opens SQLite (WAL, foreign keys on), and runs the drizzle migrator; `src/lib/auth.ts` loads `BETTER_AUTH_SECRET` or creates `<data>/secret`. This runs at boot in both `pnpm dev` and `node .output/server/index.mjs`. Hook later startup work (e.g. the Phase 3 scan) into the same plugin.
- **One DB connection:** Nitro's plugin bundle and the SSR bundle each include `src/db`, so the drizzle instance is cached on `globalThis.bookserveDb`. After changing the schema in dev, restart `pnpm dev`.
- **Migrations:** edit `src/db/schema.ts`, run `pnpm db:generate --name <change>`, and commit `drizzle/`. They are read from `./drizzle` relative to the working directory (the repo root, or `/app` in the image, where the Dockerfile copies them). Don't use `db:push`.
- **Auth tables** in `src/db/schema.ts` are hand-written to match Better Auth 1.7 with the `username` and `admin` plugins. If you add a Better Auth plugin that needs fields, add them there and generate a migration.
- **Base URL:** `BOOKSERVE_URL` sets a fixed base URL (Secure cookies when https). Unset, Better Auth takes the origin from each request, honoring `X-Forwarded-Host`/`-Proto`, and cookies are not Secure so plain-http LAN access works. Better Auth also reads `BETTER_AUTH_URL` from the env; a stale value in `.env.local` (e.g. `http://localhost:3000`) breaks sign-in when dev runs on another port.
- **Sign-up is disabled** (`disableSignUp`). Create users server-side with `auth.api.createUser` (no headers means it runs as the server, so the admin check is skipped; with request headers it requires an admin session). Email is `syntheticEmail(username)` from `#/lib/auth`; the username plugin validates and lowercases usernames, and keeps the original case in `displayUsername`.
- **Route guards:** `src/routes/__root.tsx` `beforeLoad` calls the `getAuthState` server function (`src/lib/auth-functions.ts`) on every navigation and returns `{ hasUsers, user }` (`user` = `{ id, username, role } | null`) into route context. With zero users, everything except `/setup` redirects to `/setup`. App pages go under `src/routes/_app/`; the `_app` layout redirects to `/login` without a session and narrows `context.user` to non-null. `/setup` and `/login` sit outside `_app`.
- **Session and role in a server function:** `const session = await auth.api.getSession({ headers: getRequestHeaders() })` (`getRequestHeaders` from `@tanstack/react-start/server`), then check `session?.user.role === 'admin'`. Route context is only for UI; enforce authorization on the server.
- **Client:** `authClient` (`#/lib/auth-client`) has `usernameClient()`. Add `adminClient()` there when Phase 2 needs it. After sign-in or sign-out, call `router.invalidate()` so the root `beforeLoad` runs again.
- **shadcn CLI gotcha:** it can't resolve the `#/lib/utils` alias and imports `cn` from the npm package `cn` (and adds it as a dependency). After `shadcn add`, change the import to `#/lib/utils`, `pnpm remove cn` if it was added, split `import { x, type Y }` into a separate `import type` (oxlint), and run prettier.
- **Fresh-boot test:**
  ```bash
  pnpm build
  T=$(mktemp -d)
  env -u BETTER_AUTH_SECRET -u BETTER_AUTH_URL PORT=3100 \
    BOOKSERVE_DATA_DIR=$T/data BOOKSERVE_LIBRARY_DIR=$T/books node .output/server/index.mjs
  # $T/data has bookserve.db + secret (0600), and $T/books exists before any request.
  # curl -s -o /dev/null -w '%{http_code} %{redirect_url}' localhost:3100/  -> 307 .../setup. Create the admin in a browser; /setup then redirects to /.
  ```
  Docker: `docker build -t bookserve:dev .`, then `docker run --rm -p 3200:3000 -v $T/config:/config -v $T/books:/books bookserve:dev`.

### Phase 2

- **Shell:** `src/routes/_app.tsx` renders the top bar (Bookserve, nav, user menu with sign-out) around an `<Outlet />` for every `_app` route. Add top-level nav items to its `navItems` array; `admin: true` hides an item from non-admins (UI only), `exact: true` for `/`. Pages render their own `<main className="mx-auto max-w-6xl px-4 py-8">` with an `h1`. Active links are styled with `data-[status=active]:` classes (TanStack `Link` sets `data-status`); `activeProps` classes lose to `text-muted-foreground` in the base class.
- **Styles:** `src/styles.css` is plain shadcn zinc tokens on `bg-background` (template gradient, colors and helper classes removed). `.dark` tokens are kept, but nothing sets the class yet.
- **Settings:** `src/routes/_app/settings/route.tsx` is the admin-only layout (redirects non-admins to `/`) with the side nav; add a section by adding a route file under `src/routes/_app/settings/` and an entry in its `sections` array. `/settings` redirects to `/settings/users`.
- **Admin server functions:** `src/lib/user-functions.ts`. Every admin handler starts with `const { headers, session } = await requireAdmin()` (a `createServerOnlyFn`; throws `Forbidden` without an admin session) and passes `headers` to `auth.api.*`. Validators reuse `checkUsername`/`checkPassword` from `src/lib/credentials.ts` (also used by `/setup`). Errors are thrown as plain `Error`s and shown inline by the UI.
- **Guards:** `setRole` and `removeUser` refuse acting on yourself and demoting/removing the last admin (last-admin is checked first, so a sole admin gets that message). Better Auth's raw `/api/auth/admin/{set-role,update-user,remove-user}` endpoints are closed via `disabledPaths` in `src/lib/auth.ts` so they can't bypass these guards; `auth.api.*` calls still work. If you add another way to change roles or delete users, put it in `user-functions.ts`.
- **Server-fn CSRF:** TanStack Start rejects server-function requests without a same-origin `Origin`/`Sec-Fetch-Site`/`Referer` with `403 Forbidden`. When replaying one with curl, send `-H 'origin: http://localhost:<port>' -H 'x-tsr-serverfn: true'`. A thrown error comes back as HTTP 200 with a serialized `$TSR/Error` body.
- **Dates in SSR'd tables:** format deterministically (the users table shows `createdAt` as `YYYY-MM-DD` from an ISO string) to avoid server/browser locale hydration mismatches.
- **shadcn:** `shadcn add` prompts to overwrite `button.tsx` (answer no: `--yes` does not skip that prompt, and a non-interactive run stops before writing the remaining components) and rewrites imports to `#/lib/utils.ts`/`#/components/ui/button.tsx`; fix those along with the `cn` gotcha above.
- **Verification (Phase 2):** `pnpm lint`, `pnpm typecheck`, `pnpm build`, then the fresh-boot test on port 3100 with a Playwright script (run from a temp dir under `.amp/in/`, not a dependency): setup admin → add `reader` (user) and `admin2` (admin) → invalid/duplicate username errors inline → demote/promote → reset password and log in as `reader` with it (old password rejected) → reader has no Settings link and `/settings`, `/settings/users` redirect to `/` → delete with confirmation → replayed server-fn calls: self-demote/self-delete and last-admin demote/delete rejected; `listUsers`/`removeUser` with the reader's cookie via curl return `Forbidden`; `POST /api/auth/admin/{set-role,remove-user,update-user}` → 404.

### Phase 3

- **Schema** (`src/db/schema.ts`, migration `0001_library`): `books` (uuid `id`, `title`, `sort_title`, `authors` JSON string array, `description` as plain text, `language`, `publisher`, `published_date` as `YYYY[-MM[-DD]]`, `isbn`, `series`, `series_index`, `cover_path` relative to the data dir, `matched`, `missing`, timestamps) and `book_files` (`book_id`, unique `path` relative to the library with `/` separators, `size`, `mtime_ms` (truncated), sha256 `hash`, `format` = `epub`). The model is one file per book; the same content at two live paths gives two books.
- **Scanned vs matched metadata:** the scanner owns the scalar columns and overwrites them whenever the file changes. Phase 4 writes only `books.matched` (JSON `MatchedMetadata` = `Partial<BookMetadata> & { coverPath? }`, nullable, already in the schema). Every read goes through `bookView(row)` in `src/lib/books.ts`, which overlays `matched` field by field (and recomputes the sort title from a matched title). So: put a matched cover at e.g. `covers/<id>-matched.jpg` with `matched.coverPath`, never touch scanner columns from the match flow, and "revert to file metadata" just means clearing fields from `matched`. Any drizzle update of a `books` row bumps `updatedAt` (`$onUpdate`), and cover URLs are versioned with it, so a new matched cover shows up without cache busting.
- **EPUB reader** (`src/lib/epub.ts`, `readEpub(buffer)`): fflate `unzipSync` with a `filter`, so only `META-INF/container.xml`, the OPF and the cover are decompressed (size caps: 5 MB OPF, 20 MB cover). Reads Dublin Core (creators with no role or `aut`, via `opf:role` or EPUB3 `refines`), publication date (skips `opf:event="conversion"`), ISBN (`urn:isbn:`, `opf:scheme="ISBN"`, or a bare 978/979 number), series (`calibre:series`/`series_index`, else EPUB3 `belongs-to-collection` + `group-position`), cover (EPUB3 `cover-image`, else EPUB2 `<meta name="cover">`, else an image with "cover" in its id or href; jpeg/png/gif/webp only, so no SVG is ever served). Descriptions are reduced to plain text at scan time (tags stripped, entities decoded, paragraphs kept as blank lines) and rendered as text with `whitespace-pre-line`.
- **Scanner** (`src/lib/scanner.ts`): `scanLibrary()` is the full scan, `uploadBook(name, stream)` the upload. Both go through one promise queue stored on `globalThis.bookserveScanner` (the Nitro plugin and SSR bundles each have a copy of the module), so only one scan/import runs at a time, and a scan requested while one runs joins it. Entry points: the startup plugin (`void scanLibrary()`, in the background) and the admin server function `scanLibraryNow` in `src/lib/book-functions.ts`. Per file: same size+mtime → skip; known path changed → re-read and update the same book; new path whose hash matches a row whose path no longer exists → move that row (same book id); otherwise read and insert. Unreadable files are logged and skipped (and retried on every scan). After a complete walk, books with no file found get `missing = true` (never deleted; they come back on the next scan that sees the file). The scan aborts without changes if the library root can't be read, and skips missing-marking if any subdirectory couldn't be read. Hidden entries (`.*`) and symlinks are ignored. It yields with `setImmediate` between files.
- **Server functions** (`src/lib/book-functions.ts`): `listBooks`, `getBook` (any session), `scanLibraryNow` and `removeBook` (`requireAdmin()`). `removeBook` calls the scanner's `deleteBook`, which runs in the scan queue and deletes the library file first (an error leaves the book in place), then the row and both covers. The detail page's Delete button confirms first. The grid's search filters the loaded list on the client.
- **File routes** (session required, 401 otherwise; 404 for unknown ids or files that are gone): `GET /api/books/$bookId/cover` (`private, max-age=31536000, immutable`; the UI links to `?v=<updatedAt ms>`), `GET /api/books/$bookId/download` (`application/epub+zip`, `Content-Disposition` with an RFC 5987 `filename*`). Both look up a stored relative path by id, resolve it with `resolveInside(root, rel)` and stream it with `fileResponse()` (`fs.createReadStream` → web stream). No route takes a path from the URL.
- **Upload:** `POST /api/books/upload?name=<file>.epub` with the raw file as the body, one file per request (admin only; 403 for users). The body is piped to `<data>/tmp/<uuid>.epub`, so nothing is buffered and there is no body-size limit in Nitro/srvx to raise (Node's default 5-minute `requestTimeout` still applies; a 120 MB upload was tested). The file is validated with `readEpub` (400 if invalid), then placed at `<library>/<Author>/<Title>/<name>.epub` with sanitized segments: a hard link first (atomic, fails on an existing name), else an exclusive copy (cross-device: Docker data and library volumes), with ` (n)` suffixes instead of overwriting; then it is imported through the scanner queue. The temp file is always removed.
- **UI:** `src/routes/_app/index.tsx` (grid, search, admin Scan/Upload buttons; missing books are dimmed and grayscale), `src/routes/_app/books/$bookId.tsx` (detail; "File missing" disabled button for missing books). `BookCover` (`src/components/book-cover.tsx`) renders the image or a placeholder tinted by a hash of the title. Fonts are the system stack (no Google Fonts).
- **Test data:**
  ```bash
  mkdir -p .amp/in/epubs && cd .amp/in/epubs
  for id in 1342.epub3.images 84.epub3.images 2701.epub.images 11.epub.noimages; do
    curl -sSL -o "$id.epub" "https://www.gutenberg.org/ebooks/$id"; done
  head -c 2000 /dev/urandom > corrupt.epub
  ```
  All four Gutenberg files currently ship a cover (including `11.epub.noimages`), so for the placeholder build a minimal EPUB without one (`mimetype`, `META-INF/container.xml`, an OPF with `calibre:series` and an HTML `dc:description`; a few lines of Python `zipfile`). Nest files in subfolders, then run the fresh-boot test with `BOOKSERVE_LIBRARY_DIR` pointing at the folder.
- **Verification (Phase 3):** `pnpm lint`, `pnpm typecheck`, `pnpm build`; fresh boot on port 3100 with Playwright from `.amp/in/`: startup scan imports 4 books and skips the corrupt file; add a file + Scan → added; `mv` a file → same book id; `rm` → `missing = 1`; library dir moved away + Scan → error shown, nothing marked missing; upload via the file input (including a 120 MB file and an invalid one → inline error) → lands under `<Author>/<Title>/`; downloads match `shasum -a 256`; cover/download/upload → 401 without a session; scan server function → `Forbidden` and upload → 403 with a user's cookie; `..` and encoded-slash ids → 404. Docker: `docker run -v $T/config:/config -v $T/books:/books`, and `--tmpfs /config` to force the cross-device copy path.

### Phase 4

- **Providers** (`src/lib/metadata/`): `providers.ts` is client-safe (no server imports) and holds `PROVIDERS` (id + display name), the `Candidate`/`MatchFields`/`MetadataQuery` types and the `MetadataProvider` interface: `search(query) → Candidate[]` (one request; throws an `Error` whose message is shown inline as "<Provider>: <message>") and optional `details(id) → Partial<MatchFields>` for fields the search leaves out (the candidate sets `partial: true`; the dialog calls it when the candidate is picked). `http.ts` has `fetchJson` (8 s `AbortSignal.timeout`, `User-Agent: Bookserve/1.0 (...)`, errors become "Timed out" / "Could not connect" / `HttpError` with the status) and `downloadCover` (http(s) only, 15 s, 10 MB cap enforced while streaming, `image/jpeg|png|webp` content type _and_ magic bytes, so never SVG).
  - **Open Library** (`open-library.ts`): one `search.json` request (title + author, or `isbn` alone) with `fields=` including `editions,editions.publisher,editions.isbn,editions.language`: results are works, and publisher/ISBN/language come from the best-matching edition (the work's own lists span every edition). Published date is `first_publish_year`, covers are `covers.openlibrary.org/b/id/<cover_i>-L.jpg` (`-M` for thumbnails). `details` fetches `/works/<OL…W>.json` for the description (Markdown emphasis/links stripped, then `htmlToText`).
  - **Google Books** (`google-books.ts`): `volumes?q=intitle:… inauthor:…` or `isbn:…`, `key` from `config.googleBooksApiKey` (`GOOGLE_BOOKS_API_KEY`). Largest `imageLinks` entry, `http:` → `https:`, `&edge=curl` dropped; descriptions through `htmlToText` (exported from `src/lib/epub.ts`). **Keyless requests currently always get 429** (Google's shared keyless project has a daily quota of 0); the provider reports "Quota exceeded; set GOOGLE_BOOKS_API_KEY".
  - **Adding a provider** (e.g. Hardcover): add `{ id, name }` to `PROVIDERS`, write `src/lib/metadata/<name>.ts` exporting a `MetadataProvider` (use `fetchJson`; read any key through `src/lib/config.ts`), and register it in `IMPLEMENTATIONS` in `src/lib/match-functions.ts`. The dialog, provider select and per-provider errors pick it up from `PROVIDERS`. Hardcover is GraphQL with a bearer token: `fetchJson` only does GET, so give it a POST variant with the same timeout/User-Agent handling.
- **Server functions** (`src/lib/match-functions.ts`, all `requireAdmin()`): `searchMetadata({ provider, query })` (one provider per call, so the dialog fires one per provider and renders each as it answers), `getMatchDetails({ provider, id })`, `applyMatch({ bookId, provider, providerId, fields, coverUrl })` and `revertMatch(bookId)`. `applyMatch` keeps only well-formed non-empty fields (`cleanFields`), merges them over the existing `books.matched` and records `source: { provider, id, matchedAt }`. Never called from the scanner.
- **Matched covers:** `<data>/covers/<bookId>-matched.<ext>` (`matched.coverPath`); the scanner's `<bookId>.<ext>` is never touched (its cleanup only matches `<bookId>.`). A new matched cover replaces the previous matched file; `revertMatch` sets `matched = null` and deletes `<bookId>-matched.*`. The update bumps `updatedAt`, so the cover URL's `?v=` changes and the immutable-cached route serves the new image without a hard refresh.
- **`MatchedMetadata`** gained `pageCount` (matching only; `bookView()` returns it, the detail page shows "Pages") and `source`. JSON column, so no migration. `getBook` returns `matched: boolean` for the revert button.
- **UI:** `src/components/match-dialog.tsx` (search form prefilled from the view: title, first author, ISBN; provider select; results interleaved across providers; compare table with a checkbox per field, default checked when the new value is non-empty and differs, comparing displayed text so `en`/`eng` both read "English"; description row waits on `details`). Detail page: admin-only "Match" and, when matched, "Revert to file metadata" (confirm). `languageName` moved to `#/lib/utils`.
- **Nav:** nav items take `also: '/books/'` to be active under another prefix (Library on book pages), via a `data-also-active` attribute next to TanStack's `data-status`.
- **Verification (Phase 4):** `pnpm lint`, `pnpm typecheck`, `pnpm build`; fresh boot on port 3100 with 3 Gutenberg EPUBs and Playwright from `.amp/in/`. Google Books was served by a local mock (temporary `process.env` override of its `BASE_URL`, removed afterwards) because keyless requests get 429. Checked: both providers' results listed; apply with Authors and Published unchecked changes only the checked fields on the detail page and grid; the cover `?v=` changes and the served bytes equal `covers/<id>-matched.jpg`, scanned cover file kept; `touch` + Scan ("Updated …") keeps the matched fields and cover; revert restores title/cover (same sha as before) and deletes the matched file; Open Library pointed at `http://10.255.255.1` → "Open Library: Timed out" inline after 8 s while Google results show (and live: "Google Books: Quota exceeded; set GOOGLE_BOOKS_API_KEY" next to Open Library results); a user sees no Match button, and replaying `searchMetadata`/`getMatchDetails`/`applyMatch`/`revertMatch` with their cookie returns `Forbidden` (same replay with an admin cookie returns results). `downloadCover` checked against PNG (ok), SVG, SVG served as `image/jpeg`, 12 MB, 404, a hanging server (15 s) and `file://`.
