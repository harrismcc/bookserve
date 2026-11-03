import { Link, Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/settings')({
  component: Settings,
})

// Settings sections, shown as the side nav. `admin: true` hides the item from
// non-admins; its route also redirects them (for navigation), and every admin
// server function re-checks the session with requireAdmin().
const sections = [
  { to: '/settings/api-keys', label: 'API keys' },
  { to: '/settings/sync', label: 'KOReader sync' },
  { to: '/settings/users', label: 'Users', admin: true },
  { to: '/settings/market', label: 'Market sources', admin: true },
  { to: '/settings/opds', label: 'OPDS server', admin: true },
] as const

function Settings() {
  const { user } = Route.useRouteContext()
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <div className="mt-6 flex flex-col gap-8 md:flex-row">
        <nav className="flex gap-1 text-sm md:w-48 md:flex-col">
          {sections
            .filter((section) => !('admin' in section) || user.role === 'admin')
            .map((section) => (
              <Link
                key={section.to}
                to={section.to}
                className="rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[status=active]:bg-accent data-[status=active]:font-medium data-[status=active]:text-foreground"
              >
                {section.label}
              </Link>
            ))}
        </nav>
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </main>
  )
}
