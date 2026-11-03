import { eq } from 'drizzle-orm'

import { db } from '#/db'
import { settings } from '#/db/schema'

// App-wide settings stored in the `settings` table, with their defaults.
const DEFAULTS = {
  opdsEnabled: true,
  kosyncEnabled: true,
}

type Settings = typeof DEFAULTS

export function getSetting<K extends keyof Settings>(key: K): Settings[K] {
  const row = db.select().from(settings).where(eq(settings.key, key)).get()
  return row ? (row.value as Settings[K]) : DEFAULTS[key]
}

export function setSetting<K extends keyof Settings>(
  key: K,
  value: Settings[K],
) {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run()
}
