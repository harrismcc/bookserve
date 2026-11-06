# Bookserve

A self-hosted ebook server, in the spirit of Audiobookshelf and Calibre-Web. Users keep their library of books on their own server; Bookserve stores the files, resolves metadata for them, and serves the library through a web UI.

## Architecture: self-hosted, single container

Bookserve ships as **one Docker container** that a user runs on their own hardware (a home server, NAS, or VPS). Every design decision should hold up under that constraint.

- **No external services.** Do not add a dependency on Postgres, Redis, S3, a separate worker container, or a hosted API that the app cannot run without. Anything the app needs at runtime runs inside the one Node process (or is spawned by it).
- **SQLite is the database.** Use Drizzle with `better-sqlite3`. Keep queries and schema compatible with SQLite.
- **The filesystem is the storage layer.** Book files, covers, and other assets live on disk, not in the database. Store paths in the database, not blobs.
- **All persistent state lives under mounted volumes.** Assume users mount:
  - a **data/config directory** (database, generated covers, caches, secrets), and
  - one or more **library directories** containing their books, which may be shared with other tools.

  Nothing important may be written elsewhere in the container, because it is lost when the container is recreated. Paths come from configuration (environment variables), never hardcoded absolute paths.

- **Respect the user's library files.** Treat library directories as the user's data. Never delete or rewrite book files unless the user explicitly asked for that action. Handle files that are added, moved, or removed outside the app.
- **Startup must be self-sufficient.** The container should come up from an empty data volume: create directories, run database migrations, and generate any required secrets on first boot, without manual steps.
- **Configuration via environment variables** with sensible defaults, so `docker run` with two volume mounts and a port works.
- **Network access is optional.** Metadata lookups from online sources are a feature, but the app must still work offline or when a provider is down.
- **Modest hardware.** Expect low-power machines (Raspberry Pi, NAS). Avoid heavy background work that blocks requests, and stream large files instead of buffering them in memory.
- **Multi-arch.** The image should build for `linux/amd64` and `linux/arm64`. Be careful with native modules (e.g. `better-sqlite3`) when changing the build.

## Stack

- [TanStack Start](https://tanstack.com/start) (React 19, TanStack Router file-based routes in `src/routes`) on Nitro's Node server
- Drizzle ORM + SQLite (`src/db`, migrations in `drizzle/`)
- Better Auth for authentication (`src/lib/auth.ts`)
- Tailwind CSS v4 + shadcn/ui components
- pnpm, oxlint, prettier, tsrs (TypeScript 7) for type checking

Import app code with the `#/` alias (maps to `src/`).

## Commands

```bash
pnpm dev          # dev server on http://localhost:3000
pnpm build        # production build (node .output/server/index.mjs)
pnpm lint         # oxlint
pnpm format       # prettier + oxlint --fix
pnpm typecheck    # tsrs --noEmit
pnpm db:generate  # generate a migration from src/db/schema.ts
pnpm db:migrate   # apply migrations
```

Add shadcn components with `pnpm dlx shadcn@latest add <component>`. The CLI mis-resolves the `#/` alias: after adding, make sure new files import `cn` from `#/lib/utils` (not `"cn"`), that no `cn` package was added to `package.json`, and that existing `src/components/ui/` files were not rewritten. Then run `pnpm format`.

Use `pnpm db:generate` to create committed migrations for schema changes; don't rely on `db:push`, since self-hosted installs upgrade by running migrations on startup.

## UI components

Build UI from [shadcn/ui](https://ui.shadcn.com/docs/components) components in `src/components/ui/`.

- Before writing markup for a UI element, check whether shadcn has a component for it (avatar, badge, empty state, skeleton, spinner, progress, item/list row, input group, table, label, tooltip, separator, tabs, sheet, and so on). If it does and it is not in `src/components/ui/` yet, add it with the CLI. Do not recreate it with `div`s and Tailwind classes.
- Do not bend a component into a role it is not for, such as a `Button` styled as a tag or a `Card` used as a list row. Add the component that fits.
- Customize a component at the call site with `className` and its variants. Edit a file in `src/components/ui/` only for an app-wide change, such as a theme decision.
- Write a custom component (in `src/components/`) only for something shadcn does not cover, such as `BookCover`. Compose it from shadcn components where you can.
- Style with the theme tokens in `src/styles.css` (`bg-primary`, `text-muted-foreground`, `rounded-md`, ...), never raw colors or pixel radii. Book covers use `rounded-cover`.
- Headings (`h1`, `h2`, card titles) are set in the serif automatically; everything else is sans. Do not set fonts per element.

## Market integrations

Online stores are pluggable **Market integrations** (`src/lib/market/`). To support a new store or catalog, write an integration as described in `docs/market-integrations.md`; never add store-specific routes, server functions, tables or UI. If the integration API lacks something, extend it for every integration.

## Principles

- Make the best decision that will elevate all three: the user experience (UX), developer experience (DX), and agent experience (AX) always, without breaking anything.
- Commit as you go, in logical commits. Never ask whether to commit.
- Cut taglines, helper text and secondary labels. If a screen needs them to make sense, fix the layout.

## Decisions: one-way and two-way doors

Be self-driving. Sort each decision by how costly it is to undo.

- **Two-way doors** are cheap to reverse: decide and keep going. This covers most implementation choices, naming, local structure, small scope adjustments, and obvious race-condition or security fixes. Mention notable ones in your summary.
- **One-way doors** are costly to reverse: stop and loop in the human before acting. Examples: changing the architecture, shipping a schema or storage-format change to users' installs, adding a dependency or service, touching users' library files, or discovering something that breaks an assumption the task was built on. Explain what you found, the options, and your recommendation.
- Do not add complexity for a speculative or vanishingly unlikely race or security edge case. If you think one is worth it, treat it as a one-way door: explain the concrete failure mode, likelihood, and complexity cost first.

## Scope Guard

Complete the current task with the minimum sufficient change.

### Before editing

- Read the relevant code, tests, and configuration directly. Do not work from search snippets or guesses.
- If the requirement is ambiguous or the premise is unverified, resolve that before building on it.
- State a minimal plan:
  - **Outcome** — the exact behavior requested
  - **Non-goals** — what this task will not do
  - **Files** — the smallest set expected to change
  - **Proof** — the check that will prove the change works
- Start with one implementation path. Split work only when the task has genuinely independent parts.

### While editing

- Reuse existing code, helpers, patterns, and test setup before adding anything new.
- Fix bugs at the root cause. Do not stack patches around a wrong premise.
- Add an abstraction, adapter, or config layer only for a second real caller
  in this task or a stated requirement.
- Preserve behavior outside the requested change.
- Do not design for rare or future cases nobody asked about.
- Remove code you replace. Keep an old path only when compatibility is an explicit requirement.

### Testing

- Run the narrowest existing tests that exercise the changed behavior.
- Extend the most relevant existing test before creating a new test file.
- Add a test only when changed user-observable behavior is not covered, or when the user asks for one.
- Each new test must protect a clear acceptance criterion or regression risk.
- Do not backfill unrelated coverage or introduce test infrastructure for this task alone.
- Do not use passing tests as justification for extra abstractions or scope.

### If the plan grows

Stop when the work starts adding future-use layers, workaround stacks,
unrelated cleanup, or tests for unstated behavior. Rewrite a smaller plan
and continue. Loop in the human only if the new scope is a one-way door.

### Done means

- The requested behavior works and the acceptance criteria are met
- Relevant checks pass, with the exact commands and results reported
- Every touched file is necessary and the diff contains nothing unrelated
- No debug code, backup copies, dead paths, or scratch files remain
- Assumptions, limitations, and unverified runtime behavior are stated plainly
