import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { isAPIError } from 'better-auth/api'
import { count, eq } from 'drizzle-orm'

import { db } from '#/db'
import { user } from '#/db/schema'
import { auth, syntheticEmail } from '#/lib/auth'
import { checkPassword, checkUsername } from '#/lib/credentials'

export type Role = 'admin' | 'user'

// Server functions any signed-in user may call start with this.
export const requireSession = createServerOnlyFn(async () => {
  const session = await auth.api.getSession({ headers: getRequestHeaders() })
  if (!session) throw new Error('Unauthorized')
  return session
})

// Every admin server function handler starts with this. Pass `headers` on to
// auth.api calls so Better Auth's admin plugin checks the same session.
export const requireAdmin = createServerOnlyFn(async () => {
  const headers = getRequestHeaders()
  const session = await auth.api.getSession({ headers })
  if (session?.user.role !== 'admin') throw new Error('Forbidden')
  return { headers, session }
})

function checkRole(role: string): asserts role is Role {
  if (role !== 'admin' && role !== 'user') throw new Error('Invalid role')
}

function isLastAdmin(userId: string) {
  const target = db
    .select({ role: user.role })
    .from(user)
    .where(eq(user.id, userId))
    .get()
  if (target?.role !== 'admin') return false
  const admins = db
    .select({ n: count() })
    .from(user)
    .where(eq(user.role, 'admin'))
    .get()
  return (admins?.n ?? 0) <= 1
}

// Surface Better Auth's APIError messages as plain errors for the UI.
function rethrow(err: unknown): never {
  // The email is derived from the username, so a taken email means a taken username.
  if (
    isAPIError(err) &&
    err.body?.code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL'
  ) {
    throw new Error('Username is already taken')
  }
  throw new Error(err instanceof Error ? err.message : 'Request failed')
}

export const listUsers = createServerFn({ method: 'GET' }).handler(async () => {
  const { headers } = await requireAdmin()
  const { users } = await auth.api.listUsers({
    query: { sortBy: 'createdAt' },
    headers,
  })
  // The username plugin's fields are returned at runtime but missing from the type.
  return (users as Array<(typeof users)[number] & { username: string }>).map(
    (u) => ({
      id: u.id,
      username: u.username,
      role: u.role === 'admin' ? 'admin' : 'user',
      createdAt: new Date(u.createdAt).toISOString(),
    }),
  )
})

export const createUser = createServerFn({ method: 'POST' })
  .validator((data: { username: string; password: string; role: string }) => {
    checkUsername(data.username)
    checkPassword(data.password)
    checkRole(data.role)
    return { ...data, role: data.role }
  })
  .handler(async ({ data }) => {
    const { headers } = await requireAdmin()
    await auth.api
      .createUser({
        body: {
          email: syntheticEmail(data.username),
          password: data.password,
          name: data.username,
          role: data.role,
          data: { username: data.username },
        },
        headers,
      })
      .catch(rethrow)
  })

export const setRole = createServerFn({ method: 'POST' })
  .validator((data: { userId: string; role: string }) => {
    checkRole(data.role)
    return { ...data, role: data.role }
  })
  .handler(async ({ data }) => {
    const { headers, session } = await requireAdmin()
    if (data.role === 'user' && isLastAdmin(data.userId)) {
      throw new Error('The last admin cannot be demoted')
    }
    if (data.userId === session.user.id) {
      throw new Error('You cannot change your own role')
    }
    await auth.api
      .setRole({ body: { userId: data.userId, role: data.role }, headers })
      .catch(rethrow)
  })

export const setUserPassword = createServerFn({ method: 'POST' })
  .validator((data: { userId: string; password: string }) => {
    checkPassword(data.password)
    return data
  })
  .handler(async ({ data }) => {
    const { headers } = await requireAdmin()
    await auth.api
      .setUserPassword({
        body: { userId: data.userId, newPassword: data.password },
        headers,
      })
      .catch(rethrow)
  })

export const removeUser = createServerFn({ method: 'POST' })
  .validator((data: { userId: string }) => data)
  .handler(async ({ data }) => {
    const { headers, session } = await requireAdmin()
    if (isLastAdmin(data.userId)) {
      throw new Error('The last admin cannot be deleted')
    }
    if (data.userId === session.user.id) {
      throw new Error('You cannot delete your own account')
    }
    await auth.api
      .removeUser({ body: { userId: data.userId }, headers })
      .catch(rethrow)
  })
