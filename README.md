# Bookserve

A self-hosted ebook server. See `AGENTS.md` for the architecture and `docs/plan.md` for the roadmap.

## Run with Docker

```bash
docker run -d --name bookserve -p 3000:3000 \
  -v /path/to/config:/config \
  -v /path/to/books:/books \
  ghcr.io/harrismcc/bookserve:latest
```

`latest` is the newest release, cut nightly when `main` has changed (versions like `2026.1104.0`). `edge` is the newest commit on `main` that passed CI, and `sha-<7-char commit>` pins one build.

Open http://localhost:3000 and create the admin account. On first boot the container creates the database and an auth secret in `/config`.

| Variable                | Default (image) | Purpose                                                                                                      |
| ----------------------- | --------------- | ------------------------------------------------------------------------------------------------------------ |
| `BOOKSERVE_DATA_DIR`    | `/config`       | Database, generated secret, caches                                                                           |
| `BOOKSERVE_LIBRARY_DIR` | `/books`        | Your books                                                                                                   |
| `BOOKSERVE_URL`         | unset           | Public URL, e.g. `https://books.example.com`. Unset: taken from each request (works behind a reverse proxy). |
| `BETTER_AUTH_SECRET`    | unset           | Overrides the secret generated in the data dir                                                               |
| `GOOGLE_BOOKS_API_KEY`  | unset           | Enables Google Books matching (keyless requests are rejected by Google)                                      |
| `PORT`                  | `3000`          | HTTP port                                                                                                    |

## Reading apps (OPDS and KOReader sync)

Create a key for each device under your user menu → **API keys**, and sign in with your Bookserve username and that key as the password. Deleting the key signs the device out.

- **OPDS:** the library is an OPDS 1.2 catalog at `http://<server>:3000/opds`. Add that URL to any OPDS reader (KOReader, Thorium, Moon+ Reader, Calibre…). It lists recently added books and all books by title, supports search, and downloads EPUBs. Your account password also works here. Admins can turn it off under Settings → OPDS server.
- **Reading progress:** in KOReader, open a book, then Tools → Progress sync → Custom sync server: `http://<server>:3000/kosync`, and Login with your username and key. Positions sync between devices, and the book's page in Bookserve shows how far you are. Keep KOReader's document matching on "Binary" (the default) so Bookserve can tell which book it is.

## Development

```bash
pnpm install
pnpm dev          # http://localhost:3000, data in ./data
pnpm db:seed      # users admin/password and reader/password, plus sample books
pnpm lint
pnpm typecheck
pnpm build        # then: node .output/server/index.mjs
```

Schema changes: edit `src/db/schema.ts`, run `pnpm db:generate`, and commit the new file in `drizzle/`. Migrations apply automatically on startup.

Add UI components with `pnpm dlx shadcn@latest add <component>`.
