import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core'

import type { MatchedMetadata } from '#/lib/books'

// Better Auth tables (core + `username` and `admin` plugins).
// Keep in sync with the plugins configured in src/lib/auth.ts.

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' })
    .default(false)
    .notNull(),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => new Date())
    .notNull(),
  username: text('username').unique(),
  displayUsername: text('display_username'),
  role: text('role'),
  banned: integer('banned', { mode: 'boolean' }).default(false),
  banReason: text('ban_reason'),
  banExpires: integer('ban_expires', { mode: 'timestamp_ms' }),
})

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    impersonatedBy: text('impersonated_by'),
  },
  (table) => [index('session_user_id_idx').on(table.userId)],
)

export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', {
      mode: 'timestamp_ms',
    }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', {
      mode: 'timestamp_ms',
    }),
    scope: text('scope'),
    password: text('password'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index('account_user_id_idx').on(table.userId)],
)

export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
)

// Library. A book's columns hold metadata read from its file and are owned by the
// scanner, which overwrites them whenever the file changes. Metadata from other
// sources (Phase 4 matching) goes in `matched` and wins field by field when read
// (see bookView in src/lib/books.ts), so a rescan never clobbers a match.
export const books = sqliteTable(
  'books',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    sortTitle: text('sort_title').notNull(),
    authors: text('authors', { mode: 'json' })
      .$type<string[]>()
      .default(sql`'[]'`)
      .notNull(),
    description: text('description'),
    language: text('language'),
    publisher: text('publisher'),
    publishedDate: text('published_date'),
    isbn: text('isbn'),
    series: text('series'),
    seriesIndex: real('series_index'),
    // Relative to the data dir, e.g. covers/<id>.jpg.
    coverPath: text('cover_path'),
    matched: text('matched', { mode: 'json' }).$type<MatchedMetadata>(),
    // No file for this book was found by the last complete scan. Rows are kept.
    missing: integer('missing', { mode: 'boolean' }).default(false).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index('books_sort_title_idx').on(table.sortTitle)],
)

export const bookFiles = sqliteTable(
  'book_files',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    bookId: text('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    // Relative to the library dir, with forward slashes.
    path: text('path').notNull().unique(),
    size: integer('size').notNull(),
    mtimeMs: integer('mtime_ms').notNull(),
    // sha256 of the file; finds files that were moved or renamed.
    hash: text('hash').notNull(),
    format: text('format').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('book_files_book_id_idx').on(table.bookId),
    index('book_files_hash_idx').on(table.hash),
  ],
)

// Market sources: an integration (src/lib/market/integrations) plus the
// settings an admin entered for it. The migration that creates this table
// seeds Project Gutenberg.
export const marketSources = sqliteTable('market_sources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // Integration id, e.g. `gutenberg` or `opds`.
  integration: text('integration').notNull(),
  name: text('name').notNull(),
  settings: text('settings', { mode: 'json' })
    .$type<Record<string, string>>()
    .default(sql`'{}'`)
    .notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
})

// Where a book added from the Market came from. `integration` and
// `externalId` are kept when the source is removed.
export const bookSources = sqliteTable(
  'book_sources',
  {
    bookId: text('book_id')
      .primaryKey()
      .references(() => books.id, { onDelete: 'cascade' }),
    sourceId: integer('source_id').references(() => marketSources.id, {
      onDelete: 'set null',
    }),
    integration: text('integration').notNull(),
    // The book's id within the integration.
    externalId: text('external_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index('book_sources_source_external_idx').on(
      table.sourceId,
      table.externalId,
    ),
  ],
)
