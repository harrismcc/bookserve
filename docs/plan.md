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

### Phase 2 — App shell and user management — status: done

- Layout with Library (`/`) and Settings (`/settings`) navigation, plus sign-out.
- `/settings/users` (admin only): list, add (username, password, role), change role, delete, reset password.

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
