import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'

import { db } from '#/db'
import { user } from '#/db/schema'
import { auth, syntheticEmail } from '#/lib/auth'
import { checkPassword, checkUsername } from '#/lib/credentials'
import { hardcoverEnabled } from '#/lib/metadata/hardcover'

function hasUsers() {
  return db.select({ id: user.id }).from(user).limit(1).get() !== undefined
}

// Read by the root route on every navigation; children get `user` (and
// `hardcover`, so pages can hold space for Hardcover data) from route context.
export const getAuthState = createServerFn({ method: 'GET' }).handler(
  async () => {
    const session = await auth.api.getSession({ headers: getRequestHeaders() })
    const hardcover = hardcoverEnabled()
    if (!session) return { hasUsers: hasUsers(), user: null, hardcover }
    const { id, username, role } = session.user
    return {
      hasUsers: true,
      user: { id, username: username ?? '', role },
      hardcover,
    }
  },
)

type Credentials = { username: string; password: string }

// Creates the first user as admin and signs them in. Refuses once any user exists.
export const setupAdmin = createServerFn({ method: 'POST' })
  .validator((data: Credentials) => {
    checkUsername(data.username)
    checkPassword(data.password)
    return data
  })
  .handler(async ({ data }) => {
    if (hasUsers()) throw new Error('Setup is already complete')
    await auth.api.createUser({
      body: {
        email: syntheticEmail(data.username),
        password: data.password,
        name: data.username,
        role: 'admin',
        data: { username: data.username },
      },
    })
    await auth.api.signInUsername({
      body: { username: data.username, password: data.password },
      headers: getRequestHeaders(),
    })
  })
