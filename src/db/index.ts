import fs from 'node:fs'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

import { config } from '#/lib/config'
import * as schema from './schema.ts'

// Create the data and library dirs, open the DB, and apply pending migrations.
function openDatabase() {
  fs.mkdirSync(config.dataDir, { recursive: true })
  fs.mkdirSync(config.libraryDir, { recursive: true })

  const sqlite = new Database(config.databasePath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  const database = drizzle(sqlite, { schema })
  migrate(database, { migrationsFolder: config.migrationsDir })
  return database
}

// One connection per process: Nitro's startup plugin and the SSR bundle each include
// this module (and dev reloads re-evaluate it), so the instance lives on globalThis.
const globalForDb = globalThis as typeof globalThis & {
  bookserveDb?: ReturnType<typeof openDatabase>
}

export const db = (globalForDb.bookserveDb ??= openDatabase())
