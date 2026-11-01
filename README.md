# Bookserve

A self-hosted ebook server. See `AGENTS.md` for the architecture and `docs/plan.md` for the roadmap.

## Run with Docker

```bash
docker build -t bookserve .
docker run -d --name bookserve -p 3000:3000 \
  -v /path/to/config:/config \
  -v /path/to/books:/books \
  bookserve
```

Open http://localhost:3000 and create the admin account. On first boot the container creates the database and an auth secret in `/config`.

| Variable                | Default (image) | Purpose                                                                                                      |
| ----------------------- | --------------- | ------------------------------------------------------------------------------------------------------------ |
| `BOOKSERVE_DATA_DIR`    | `/config`       | Database, generated secret, caches                                                                           |
| `BOOKSERVE_LIBRARY_DIR` | `/books`        | Your books                                                                                                   |
| `BOOKSERVE_URL`         | unset           | Public URL, e.g. `https://books.example.com`. Unset: taken from each request (works behind a reverse proxy). |
| `BETTER_AUTH_SECRET`    | unset           | Overrides the secret generated in the data dir                                                               |
| `PORT`                  | `3000`          | HTTP port                                                                                                    |

## Development

```bash
pnpm install
pnpm dev          # http://localhost:3000, data in ./data
pnpm lint
pnpm typecheck
pnpm build        # then: node .output/server/index.mjs
```

Schema changes: edit `src/db/schema.ts`, run `pnpm db:generate`, and commit the new file in `drizzle/`. Migrations apply automatically on startup.

Add UI components with `pnpm dlx shadcn@latest add <component>`.
