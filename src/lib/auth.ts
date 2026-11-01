import crypto from 'node:crypto'
import fs from 'node:fs'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, username } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'

import { db } from '#/db'
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

export const syntheticEmail = (name: string) =>
  `${name.toLowerCase()}@bookserve.local`
