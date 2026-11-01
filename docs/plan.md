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
- **Metadata:** read embedded EPUB metadata and cover on scan. Online matching is manual (as in Audiobookshelf). Open Library comes first (no key), then Google Books (optional key). Hardcover is later and optional. Matched metadata and covers are stored in the DB and data dir, never written into book files.
- **Dependencies for scanning:** `fflate` (unzip) + `fast-xml-parser` (OPF). Both are pure JS. EPUB first; PDF later.
- **Uploads** are saved to `<library>/<Author>/<Title>/<file>`. This is the only place the app writes into the library.

## Phases

### Phase 1 — Foundation and first-run setup — status: not started
- Config module for env paths and defaults.
- Startup: create directories, run migrations, persist the generated secret.
- Better Auth wired to Drizzle (SQLite) with the `username` and `admin` plugins; auth schema in `src/db/schema.ts`; committed migration. Remove the demo `todos` table.
- `/setup` only when there are zero users: it creates the admin, then signs in. Otherwise it redirects.
- `/login`. Every app route requires a session.
- Dockerfile (multi-arch, `better-sqlite3` native build) plus a `.dockerignore`.

### Phase 2 — App shell and user management — status: not started
- Layout with Library (`/`) and Settings (`/settings`) navigation, plus sign-out.
- `/settings/users` (admin only): list, add (username, password, role), delete, reset password.

### Phase 3 — Library scanning and the grid view — status: not started
- `books` / `book_files` tables.
- Scanner: walk the library directory for `.epub`, read OPF metadata and the cover (cached into the data dir), and handle added, moved, or removed files. Runs on startup and on demand (an admin button).
- Library grid of covers; book detail page; download/stream the file.
- Upload an EPUB into the library.

### Phase 4 — Online metadata matching — status: not started
- Provider interface; Open Library and Google Books providers with timeouts (the app works offline).
- On the book detail page, "Match" searches, lists candidates, and lets the user choose fields to apply. Covers are cached on disk.

### Later
In-browser reader, OPDS, Hardcover provider, file watching, PDF metadata, multiple libraries.

## Notes log

Append short notes here: gotchas, conventions established, verification commands.
