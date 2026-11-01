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

### Phase 1 — Foundation and first-run setup — status: done

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
