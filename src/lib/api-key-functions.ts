import crypto from 'node:crypto'
import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq } from 'drizzle-orm'

import { db } from '#/db'
import { apiKeys } from '#/db/schema'
import { apiKeyHash, md5 } from '#/lib/auth'
import { requireSession } from '#/lib/user-functions'

// Keys are typed on e-reader keyboards: 20 lowercase letters and digits (no
// look-alikes, about 99 bits) in groups of five, e.g. `k7mq2-x9prt-4hw3n-zt8ca`.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

function generateKey() {
  const chars = Array.from(
    { length: 20 },
    () => ALPHABET[crypto.randomInt(ALPHABET.length)],
  )
  return [0, 5, 10, 15].map((i) => chars.slice(i, i + 5).join('')).join('-')
}

export const listApiKeys = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { user } = await requireSession()
    return db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.userId, user.id))
      .orderBy(desc(apiKeys.createdAt))
      .all()
      .map((key) => ({ ...key, createdAt: key.createdAt.toISOString() }))
  },
)

// Returns the key itself; only its hash is stored, so this is the one chance
// to see it.
export const createApiKey = createServerFn({ method: 'POST' })
  .validator((data: { name: string }) => {
    const name = data.name.trim()
    if (!name || name.length > 50) {
      throw new Error('Name must be 1 to 50 characters')
    }
    return { name }
  })
  .handler(async ({ data }) => {
    const { user } = await requireSession()
    const key = generateKey()
    db.insert(apiKeys)
      .values({
        id: crypto.randomUUID(),
        userId: user.id,
        name: data.name,
        keyHash: apiKeyHash(md5(key)),
      })
      .run()
    return key
  })

export const deleteApiKey = createServerFn({ method: 'POST' })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const { user } = await requireSession()
    db.delete(apiKeys)
      .where(and(eq(apiKeys.id, data.id), eq(apiKeys.userId, user.id)))
      .run()
  })
