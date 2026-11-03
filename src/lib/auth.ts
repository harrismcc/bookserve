import crypto from 'node:crypto'
import fs from 'node:fs'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, username } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { and, eq } from 'drizzle-orm'

import { db } from '#/db'
import { apiKeys, user } from '#/db/schema'
import { config } from '#/lib/config'

// BETTER_AUTH_SECRET wins; otherwise generate one on first boot and keep it in the data dir.
function loadSecret() {
  if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET
  if (!fs.existsSync(config.secretPath)) {
    fs.writeFileSync(
      config.secretPath,
      crypto.randomBytes(32).toString('hex'),
      {
        mode: 0o600,
      },
    )
  }
  return fs.readFileSync(config.secretPath, 'utf8').trim()
}

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'sqlite' }),
  secret: loadSecret(),
  // With BOOKSERVE_URL unset, the base URL (and trusted origin) is taken from each request,
  // honoring X-Forwarded-Host/Proto from a reverse proxy. Cookies are then not marked Secure,
  // so plain-http LAN access works; setting an https BOOKSERVE_URL turns Secure cookies on.
  baseURL: config.publicUrl,
  advanced: {
    trustedProxyHeaders: true,
    ...(config.publicUrl ? {} : { useSecureCookies: false }),
  },
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
  },
  // Role changes and deletes go through the server functions in src/lib/user-functions.ts,
  // which refuse self-demotion/self-deletion and removing the last admin. Close the raw
  // HTTP endpoints that could bypass those guards (auth.api calls are unaffected).
  disabledPaths: [
    '/admin/set-role',
    '/admin/update-user',
    '/admin/remove-user',
  ],
  plugins: [username(), admin(), tanstackStartCookies()],
})

export const md5 = (value: string) =>
  crypto.createHash('md5').update(value).digest('hex')

// API keys are stored as sha256(md5(key)): KOSync clients send md5(key), and
// a key used as a Basic password is md5'd first to get the same value.
export const apiKeyHash = (md5Key: string) =>
  crypto.createHash('sha256').update(md5Key).digest('hex')

const isBanned = (u: typeof user.$inferSelect) =>
  Boolean(u.banned && (!u.banExpires || u.banExpires > new Date()))

// The user an API key belongs to, given the username and md5(key). Keys are
// random, so a lookup needs no throttling or slow hashing.
export function apiKeyUser(name: string, md5Key: string) {
  const row = db
    .select({ user })
    .from(apiKeys)
    .innerJoin(user, eq(user.id, apiKeys.userId))
    .where(
      and(
        eq(apiKeys.keyHash, apiKeyHash(md5Key)),
        eq(user.username, name.toLowerCase()),
      ),
    )
    .get()
  return row && !isBanned(row.user) ? row.user : null
}

// The signed-in user for a request: a session cookie, or HTTP Basic
// credentials (username and an API key) from clients such as OPDS readers.
export async function requestUser(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (session) return session.user
  const match = /^Basic\s+(\S+)$/i.exec(
    request.headers.get('authorization') ?? '',
  )
  if (!match) return null
  const decoded = Buffer.from(match[1], 'base64').toString('utf8')
  const sep = decoded.indexOf(':')
  if (sep < 0) return null
  return apiKeyUser(decoded.slice(0, sep), md5(decoded.slice(sep + 1)))
}

// Asks clients without a session (e.g. OPDS readers) for Basic credentials.
export const unauthorized = () =>
  new Response('Unauthorized', {
    status: 401,
    headers: { 'www-authenticate': 'Basic realm="Bookserve", charset="UTF-8"' },
  })

export const syntheticEmail = (name: string) =>
  `${name.toLowerCase()}@bookserve.local`
