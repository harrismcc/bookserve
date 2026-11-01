import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import { ChevronDown, LogOut } from 'lucide-react'

import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { authClient } from '#/lib/auth-client'

// Pathless layout: every route under src/routes/_app/ requires a session
// and renders inside the app shell (top bar + page).
export const Route = createFileRoute('/_app')({
  beforeLoad: ({ context }) => {
    if (!context.user) throw redirect({ to: '/login' })
    return { user: context.user }
  },
  component: AppShell,
})

// Top-bar navigation. `admin: true` hides the item from non-admins;
// the route itself must still guard access.
const navItems = [
  { to: '/', label: 'Library', exact: true },
  { to: '/settings', label: 'Settings', admin: true },
] as const

function AppShell() {
  const { user } = Route.useRouteContext()
  const router = useRouter()

  async function signOut() {
    await authClient.signOut()
    await router.invalidate()
  }

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-8 px-4">
          <Link to="/" className="font-semibold">
            Bookserve
          </Link>
          <nav className="flex items-center gap-6 text-sm">
            {navItems
              .filter((item) => !('admin' in item) || user.role === 'admin')
              .map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  activeOptions={{ exact: 'exact' in item }}
                  className="text-muted-foreground transition-colors hover:text-foreground data-[status=active]:font-medium data-[status=active]:text-foreground"
                >
                  {item.label}
                </Link>
              ))}
          </nav>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="ml-auto">
                {user.username}
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={signOut}>
                <LogOut />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <Outlet />
    </div>
  )
}
