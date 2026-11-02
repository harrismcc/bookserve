import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { MoreHorizontal } from 'lucide-react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { useAction } from '#/hooks/use-action'
import {
  createUser,
  listUsers,
  removeUser,
  setRole,
  setUserPassword,
} from '#/lib/user-functions'

export const Route = createFileRoute('/_app/settings/users')({
  loader: () => listUsers(),
  component: Users,
})

type User = Awaited<ReturnType<typeof listUsers>>[number]

function Users() {
  const users = Route.useLoaderData()
  const { user: me } = Route.useRouteContext()
  const roleAction = useAction()
  const [adding, setAdding] = useState(false)
  const [resetting, setResetting] = useState<User | null>(null)
  const [deleting, setDeleting] = useState<User | null>(null)

  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Users</h2>
        <Button onClick={() => setAdding(true)}>Add user</Button>
      </div>
      {roleAction.error && (
        <p className="text-sm text-destructive">{roleAction.error}</p>
      )}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Username</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => {
              const isMe = u.id === me.id
              const newRole = u.role === 'admin' ? 'user' : 'admin'
              return (
                <TableRow key={u.id}>
                  <TableCell className="pl-4 font-medium">
                    {u.username}
                  </TableCell>
                  <TableCell className="capitalize">{u.role}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {u.createdAt.slice(0, 10)}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu modal={false}>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Actions for ${u.username}`}
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          disabled={isMe}
                          onSelect={() =>
                            roleAction.run(() =>
                              setRole({
                                data: { userId: u.id, role: newRole },
                              }),
                            )
                          }
                        >
                          {newRole === 'admin' ? 'Make admin' : 'Make user'}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setResetting(u)}>
                          Reset password
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={isMe}
                          onSelect={() => setDeleting(u)}
                        >
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      <AddUserDialog open={adding} onOpenChange={setAdding} />
      <ResetPasswordDialog
        user={resetting}
        onClose={() => setResetting(null)}
      />
      <DeleteUserDialog user={deleting} onClose={() => setDeleting(null)} />
    </section>
  )
}

function AddUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { error, setError, pending, run } = useAction()

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const ok = await run(() =>
      createUser({
        data: {
          username: String(form.get('username')),
          password: String(form.get('password')),
          role: String(form.get('role')),
        },
      }),
    )
    if (ok) onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setError('')
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="new-username">Username</Label>
            <Input
              id="new-username"
              name="username"
              autoComplete="off"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-password">Password</Label>
            <Input
              id="new-password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-role">Role</Label>
            <Select name="role" defaultValue="user">
              <SelectTrigger id="new-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              Add user
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ResetPasswordDialog({
  user,
  onClose,
}: {
  user: User | null
  onClose: () => void
}) {
  const { error, setError, pending, run } = useAction()

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user) return
    const form = new FormData(event.currentTarget)
    const ok = await run(() =>
      setUserPassword({
        data: { userId: user.id, password: String(form.get('password')) },
      }),
    )
    if (ok) onClose()
  }

  return (
    <Dialog
      open={user !== null}
      onOpenChange={(open) => {
        if (open) return
        setError('')
        onClose()
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Reset password for {user?.username}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="reset-password">New password</Label>
            <Input
              id="reset-password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              Reset password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteUserDialog({
  user,
  onClose,
}: {
  user: User | null
  onClose: () => void
}) {
  const { error, setError, pending, run } = useAction()

  async function onConfirm(event: React.MouseEvent) {
    // Keep the dialog open until the request finishes so errors show inline.
    event.preventDefault()
    if (!user) return
    const ok = await run(() => removeUser({ data: { userId: user.id } }))
    if (ok) onClose()
  }

  return (
    <AlertDialog
      open={user !== null}
      onOpenChange={(open) => {
        if (open) return
        setError('')
        onClose()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {user?.username}?</AlertDialogTitle>
        </AlertDialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={onConfirm}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
