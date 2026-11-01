import { Link, Outlet, createFileRoute, redirect } from '@tanstack/react-router'

// Admin-only. This guard is for navigation; every settings server function
// re-checks the session with requireAdmin() (src/lib/user-functions.ts).
export const Route = createFileRoute('/_app/settings')({
  beforeLoad: ({ context }) => {
    if (context.user.role !== 'admin') throw redirect({ to: '/' })
  },
  component: Settings,
})

// Settings sections, shown as the side nav.
const sections = [{ to: '/settings/users', label: 'Users' }] as const

function Settings() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <div className="mt-6 flex flex-col gap-8 md:flex-row">
        <nav className="flex gap-1 text-sm md:w-48 md:flex-col">
          {sections.map((section) => (
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
