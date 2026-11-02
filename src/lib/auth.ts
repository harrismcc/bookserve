import crypto from 'node:crypto'
import fs from 'node:fs'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, username } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { and, eq } from 'drizzle-orm'

import { db } from '#/db'
import { account, user } from '#/db/schema'
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

// Authorization header digest -> the password hash it was verified against.
// Hashing is slow on a Pi and OPDS readers send Basic credentials with every
// feed page and cover, so each one is checked once per password hash.
const verifiedBasic = new Map<string, string>()

// The signed-in user for a request: a session cookie, or HTTP Basic
// credentials (username and password) from clients such as OPDS readers.
export async function requestUser(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (session) return session.user
  const header = request.headers.get('authorization') ?? ''
  const match = /^Basic\s+(\S+)$/i.exec(header)
  if (!match) return null
  const decoded = Buffer.from(match[1], 'base64').toString('utf8')
  const sep = decoded.indexOf(':')
  if (sep < 0) return null
  const row = db
    .select({ user, hash: account.password })
    .from(user)
    .innerJoin(
      account,
      and(eq(account.userId, user.id), eq(account.providerId, 'credential')),
    )
    .where(eq(user.username, decoded.slice(0, sep).toLowerCase()))
    .get()
  if (!row?.hash) return null
  const { banned, banExpires } = row.user
  if (banned && (!banExpires || banExpires > new Date())) return null
  const digest = crypto.createHash('sha256').update(header).digest('hex')
  if (verifiedBasic.get(digest) !== row.hash) {
    const password = decoded.slice(sep + 1)
    const ctx = await auth.$context
    if (!(await ctx.password.verify({ hash: row.hash, password }))) return null
    verifiedBasic.set(digest, row.hash)
  }
  return row.user
}

// Asks clients without a session (e.g. OPDS readers) for Basic credentials.
export const unauthorized = () =>
  new Response('Unauthorized', {
    status: 401,
    headers: { 'www-authenticate': 'Basic realm="Bookserve", charset="UTF-8"' },
  })

export const syntheticEmail = (name: string) =>
  `${name.toLowerCase()}@bookserve.local`
