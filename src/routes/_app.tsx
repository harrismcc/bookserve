import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'

// Pathless layout: every route under src/routes/_app/ requires a session.
export const Route = createFileRoute('/_app')({
  beforeLoad: ({ context }) => {
    if (!context.user) throw redirect({ to: '/login' })
    return { user: context.user }
  },
  component: Outlet,
})
