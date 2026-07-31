import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import {
  Shield,
  Plus,
  Trash2,
  Key,
  LogOut,
  HardDrive,
  User,
  Users,
  Eye,
  EyeOff,
  Archive,
  RotateCcw,
} from 'lucide-react'
import { success, failure } from '@/lib/toast.js'
import {
  changeOwnPassword,
  createAccount,
  createDisk,
  createSpace,
  deleteAccount,
  deleteDisk,
  deleteSpace,
  fetchAccounts,
  fetchAuthStatus,
  fetchDiskTeams,
  createDiskTeam,
  updateDiskTeam,
  deleteDiskTeam,
  fetchSpaces,
  login,
  logout,
  resetAccountPassword,
  setup,
  updateDisk,
  updateSpace,
  fetchBackups,
  createBackup,
  restoreBackup,
  deleteBackup,
  fetchStats,
  type AuthInfo,
  type BackupInfo,
  type SummaryStats,
} from '../lib/adminApi.js'
import type { DiskTeam } from '../../../shared/api.js'

function PwInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  autoComplete,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
  autoComplete?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <Input
        type={show ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        className="pr-8"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        tabIndex={-1}
      >
        {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </button>
    </div>
  )
}

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  action,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  description: string
  action: string
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:opacity-90"
          >
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`
  return `${(n / (1024 * 1024)).toFixed(1)}MB`
}

// ── Login ────────────────────────────────────────────────────────────

function LoginForm({
  onLogin,
  rateLimit: rl,
}: {
  onLogin: (u: AuthInfo['user']) => void
  rateLimit: AuthInfo['rateLimit']
}) {
  const [u, setU] = useState('')
  const [p, setP] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const go = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      onLogin(await login(u, p))
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }
  const remaining = 10 - rl.attempts
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-[360px] animate-slide-up">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="size-4" />
            Admin Login
          </CardTitle>
          <p className="text-xs text-muted-foreground">Sign in to manage spaces, disks, and accounts.</p>
        </CardHeader>
        <CardContent>
          {rl.attempts > 0 && (
            <div
              className={`mb-3 rounded-sm px-3 py-2 text-xs ${rl.captcha ? 'bg-amber-400/10 text-amber-400' : 'bg-muted text-muted-foreground'}`}
            >
              {rl.captcha ? '⚠ Rate limit near — remaining attempts: ' : 'Remaining attempts: '}
              {remaining}
            </div>
          )}
          {err && <div className="mb-3 rounded-sm bg-destructive/10 px-3 py-2 text-xs text-destructive">{err}</div>}
          <form onSubmit={go} className="space-y-3">
            <Input
              placeholder="Username"
              value={u}
              onChange={(e) => setU(e.target.value)}
              autoFocus
              autoComplete="username"
            />
            <PwInput placeholder="Password" value={p} onChange={setP} autoComplete="current-password" />
            <Button type="submit" className="w-full" disabled={busy || !u || !p}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

// ── Setup ───────────────────────────────────────────────────────────

function SetupForm({ onDone }: { onDone: (u: AuthInfo['user']) => void }) {
  const [u, setU] = useState('')
  const [p, setP] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const go = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    if (p.length < 10) {
      setErr('Password must be at least 10 characters')
      return
    }
    setBusy(true)
    try {
      onDone(await setup(u, p))
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-[360px] animate-slide-up">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="size-4" />
            Initial Setup
          </CardTitle>
          <p className="text-xs text-muted-foreground">Create the first admin account. You will be the owner.</p>
        </CardHeader>
        <CardContent>
          {err && <div className="mb-3 rounded-sm bg-destructive/10 px-3 py-2 text-xs text-destructive">{err}</div>}
          <form onSubmit={go} className="space-y-3">
            <Input placeholder="Username" value={u} onChange={(e) => setU(e.target.value)} autoFocus />
            <PwInput placeholder="Password (min 10 chars)" value={p} onChange={setP} />
            <Button className="w-full" disabled={busy || !u || p.length < 10}>
              {busy ? 'Creating…' : 'Create Admin'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

// ── Stats Bar ────────────────────────────────────────────────────────

function StatsBar({ stats }: { stats: SummaryStats }) {
  const items = [
    { label: 'Spaces', value: stats.spaces, icon: HardDrive },
    { label: 'Disks', value: stats.disks, icon: HardDrive },
    { label: 'Teams', value: stats.teams, icon: Users },
    { label: 'Team Users', value: stats.teamUsers, icon: User },
    { label: 'Accounts', value: stats.accounts, icon: Shield },
  ]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-lg border border-border/50 bg-surface/30 px-4 py-3 flex items-center gap-3"
        >
          <item.icon className="size-4 text-muted-foreground shrink-0" />
          <div>
            <p className="text-lg font-semibold tabular-nums">{item.value}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{item.label}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Accounts ─────────────────────────────────────────────────────────

function AccountsPanel() {
  const [list, setList] = useState<any[]>([])
  const [err, setErr] = useState('')
  const [show, setShow] = useState(false)
  const [nu, setNu] = useState('')
  const [np, setNp] = useState('')
  const [nr, setNr] = useState('admin')
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [confirmName, setConfirmName] = useState('')
  const [resetId, setResetId] = useState<number | null>(null)
  const [resetPw, setResetPw] = useState('')

  const load = useCallback(async () => {
    try {
      setList(await fetchAccounts())
      setErr('')
    } catch {
      /* */
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    try {
      await createAccount(nu, np, nr)
      success('Account created', nu)
      setShow(false)
      setNu('')
      setNp('')
      await load()
    } catch (e: any) {
      setErr(e.message)
      failure('Create failed', e.message)
    }
  }
  const del = async (id: number) => {
    try {
      await deleteAccount(id)
      success('Account deleted')
      await load()
    } catch (e: any) {
      failure('Delete failed', e.message)
    }
  }
  const doReset = async () => {
    if (!resetId) return
    try {
      await resetAccountPassword(resetId, resetPw)
      success('Password reset')
      setResetId(null)
      setResetPw('')
    } catch (e: any) {
      failure('Reset failed', e.message)
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 py-3">
        <CardTitle className="text-sm">Accounts · {list.length}</CardTitle>
        <Button size="sm" onClick={() => setShow(true)}>
          <Plus className="size-3.5 mr-1" />
          Add
        </Button>
      </CardHeader>
      {err && (
        <div className="px-4 pb-2">
          <p className="rounded-sm bg-destructive/10 px-3 py-2 text-xs text-destructive">{err}</p>
        </div>
      )}
      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-border text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="py-2 pl-4">Username</th>
              <th className="py-2">Role</th>
              <th className="py-2">Created</th>
              <th className="py-2 pr-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                <td className="py-2 pl-4">{a.username}</td>
                <td className="py-2">
                  <Badge variant={a.role === 'owner' ? 'default' : 'secondary'} className="text-[10px]">
                    {a.role}
                  </Badge>
                </td>
                <td className="py-2 text-muted-foreground">{a.created_at.slice(0, 10)}</td>
                <td className="py-2 pr-4">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setResetId(a.id)
                        setResetPw('')
                      }}
                    >
                      <Key className="size-3" />
                    </Button>
                    {a.role !== 'owner' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setConfirmId(a.id)
                          setConfirmName(a.username)
                        }}
                      >
                        <Trash2 className="size-3 text-destructive" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={show} onOpenChange={setShow}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>Create Account</DialogTitle>
          </DialogHeader>
          <form onSubmit={create} className="space-y-3">
            <Input placeholder="Username" value={nu} onChange={(e) => setNu(e.target.value)} autoFocus />
            <PwInput placeholder="Password" value={np} onChange={setNp} />
            <select
              value={nr}
              onChange={(e) => setNr(e.target.value)}
              className="flex h-9 w-full rounded-sm border border-border bg-background px-3 text-sm"
            >
              <option value="admin">admin</option>
              <option value="owner">owner</option>
            </select>
            <Button type="submit" className="w-full" disabled={!nu || np.length < 10}>
              Create
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmId !== null}
        onOpenChange={() => setConfirmId(null)}
        title="Delete Account"
        description={`Remove '${confirmName}'? This cannot be undone.`}
        action="Delete"
        onConfirm={() => {
          if (confirmId !== null) del(confirmId)
          setConfirmId(null)
        }}
      />

      <Dialog open={resetId !== null} onOpenChange={() => setResetId(null)}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              doReset()
            }}
            className="space-y-3"
          >
            <PwInput placeholder="New password (min 10 chars)" value={resetPw} onChange={setResetPw} autoFocus />
            <Button type="submit" className="w-full" disabled={resetPw.length < 10}>
              Reset
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

// ── Spaces & Disks ───────────────────────────────────────────────────

function SpacesPanel() {
  const [spaces, setSpaces] = useState<any[]>([])
  const [err, setErr] = useState('')
  const [modal, setModal] = useState<{ type: 'space' | 'disk'; id?: number; spaceId?: number } | null>(null)
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [confirmSpaceId, setConfirmSpaceId] = useState<number | null>(null)
  const [confirmSpaceName, setConfirmSpaceName] = useState('')
  const [confirmDiskId, setConfirmDiskId] = useState<number | null>(null)
  const [confirmDiskName, setConfirmDiskName] = useState('')
  const [teamsDiskId, setTeamsDiskId] = useState<number | null>(null)
  const [teamsDiskName, setTeamsDiskName] = useState('')

  const load = useCallback(async () => {
    try {
      setSpaces(await fetchSpaces())
      setErr('')
    } catch {
      /* */
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const addSpace = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await createSpace(name)
      success('Space created', name)
      setModal(null)
      await load()
    } catch (e: any) {
      failure('Create failed', e.message)
    }
  }
  const renameSpace = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!modal?.id) return
    try {
      await updateSpace(modal.id, name)
      success('Space renamed', name)
      setModal(null)
      await load()
    } catch (e: any) {
      failure('Rename failed', e.message)
    }
  }
  const delSpace = async (id: number) => {
    try {
      await deleteSpace(id)
      success('Space deleted')
      await load()
    } catch (e: any) {
      failure('Delete failed', e.message)
    }
  }
  const addDisk = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!modal?.spaceId) return
    try {
      await createDisk(modal.spaceId, name, path)
      success('Disk created', name)
      setModal(null)
      await load()
    } catch (e: any) {
      failure('Create failed', e.message)
    }
  }
  const editDisk = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!modal?.id) return
    try {
      await updateDisk(modal.id, { name, path })
      success('Disk updated', name)
      setModal(null)
      await load()
    } catch (e: any) {
      failure('Update failed', e.message)
    }
  }
  const delDisk = async (id: number) => {
    try {
      await deleteDisk(id)
      success('Disk deleted')
      await load()
    } catch (e: any) {
      failure('Delete failed', e.message)
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 py-3">
        <CardTitle className="text-sm">Spaces & Disks</CardTitle>
        <Button
          size="sm"
          onClick={() => {
            setModal({ type: 'space' })
            setName('')
          }}
        >
          <Plus className="size-3.5 mr-1" />
          Space
        </Button>
      </CardHeader>
      {err && (
        <div className="px-4 pb-2">
          <p className="rounded-sm bg-destructive/10 px-3 py-2 text-xs text-destructive">{err}</p>
        </div>
      )}
      <div className="px-4 pb-4 space-y-3">
        {spaces.length === 0 && (
          <p className="text-xs text-muted-foreground py-4 text-center">No spaces yet. Create one to group disks.</p>
        )}
        {spaces.map((s) => (
          <div key={s.id} className="rounded-sm border border-border">
            <div className="flex items-center justify-between bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-2">
                <HardDrive className="size-3.5 text-muted-foreground" />
                <span className="text-sm font-medium">{s.name}</span>
                <span className="text-[10px] text-muted-foreground">
                  · {s.disks.length} disk{s.disks.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setModal({ type: 'disk', spaceId: s.id })
                    setName('')
                    setPath('')
                  }}
                >
                  <Plus className="size-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setModal({ type: 'space', id: s.id })
                    setName(s.name)
                  }}
                >
                  Rename
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setConfirmSpaceId(s.id)
                    setConfirmSpaceName(s.name)
                  }}
                >
                  <Trash2 className="size-3 text-destructive" />
                </Button>
              </div>
            </div>
            {s.disks.length > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
                    <th className="py-1.5 pl-3">Name</th>
                    <th className="py-1.5">Path</th>
                    <th className="py-1.5">Teams</th>
                    <th className="py-1.5 pr-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {s.disks.map((d: any) => (
                    <tr key={d.id} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                      <td className="py-1.5 pl-3">{d.name}</td>
                      <td className="py-1.5 font-mono text-[11px] text-muted-foreground">{d.path}</td>
                      <td className="py-1.5">
                        <TeamCountBadge diskId={d.id} />
                      </td>
                      <td className="py-1.5 pr-3">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setTeamsDiskId(d.id)
                              setTeamsDiskName(d.name)
                            }}
                            title="Manage teams/users"
                          >
                            <Users className="size-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setModal({ type: 'disk', id: d.id })
                              setName(d.name)
                              setPath(d.path)
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setConfirmDiskId(d.id)
                              setConfirmDiskName(d.name)
                            }}
                          >
                            <Trash2 className="size-3 text-destructive" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="px-3 py-2 text-[11px] text-muted-foreground">No disks in this space.</p>
            )}
          </div>
        ))}
      </div>

      <Dialog open={modal?.type === 'space'} onOpenChange={() => setModal(null)}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>{modal?.id ? 'Rename Space' : 'New Space'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={modal?.id ? renameSpace : addSpace} className="space-y-3">
            <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <Button type="submit" className="w-full" disabled={!name}>
              {modal?.id ? 'Rename' : 'Create'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={modal?.type === 'disk'} onOpenChange={() => setModal(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{modal?.id ? 'Edit Disk' : 'Add Disk'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={modal?.id ? editDisk : addDisk} className="space-y-3">
            <Input placeholder="Display name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <Input placeholder="Path to report.db directory" value={path} onChange={(e) => setPath(e.target.value)} />
            <Button type="submit" className="w-full" disabled={!name || !path}>
              {modal?.id ? 'Save' : 'Create'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmSpaceId !== null}
        onOpenChange={() => setConfirmSpaceId(null)}
        title="Delete Space"
        description={`Delete '${confirmSpaceName}' and all its disks? This cannot be undone.`}
        action="Delete"
        onConfirm={() => {
          if (confirmSpaceId !== null) delSpace(confirmSpaceId)
          setConfirmSpaceId(null)
        }}
      />
      <ConfirmDialog
        open={confirmDiskId !== null}
        onOpenChange={() => setConfirmDiskId(null)}
        title="Delete Disk"
        description={`Remove '${confirmDiskName}'? This cannot be undone.`}
        action="Delete"
        onConfirm={() => {
          if (confirmDiskId !== null) delDisk(confirmDiskId)
          setConfirmDiskId(null)
        }}
      />

      <TeamsDialog
        diskId={teamsDiskId}
        diskName={teamsDiskName}
        onClose={() => setTeamsDiskId(null)}
        onChanged={load}
      />
    </Card>
  )
}

function TeamCountBadge({ diskId }: { diskId: number }) {
  const [teams, setTeams] = useState<DiskTeam[]>([])
  useEffect(() => {
    if (diskId)
      fetchDiskTeams(diskId)
        .then(setTeams)
        .catch(() => {})
  }, [diskId])
  const userCount = teams.reduce((s, t) => s + t.users.length, 0)
  return (
    <span className="text-[11px] text-muted-foreground">
      {teams.length > 0
        ? `${teams.length} team${teams.length !== 1 ? 's' : ''}, ${userCount} user${userCount !== 1 ? 's' : ''}`
        : '—'}
    </span>
  )
}

// ── Teams Dialog ─────────────────────────────────────────────────────

function TeamsDialog({
  diskId,
  diskName,
  onClose,
  onChanged,
}: {
  diskId: number | null
  diskName: string
  onClose: () => void
  onChanged: () => void
}) {
  const [teams, setTeams] = useState<DiskTeam[]>([])
  const [busy, setBusy] = useState(true)
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<DiskTeam | null>(null)
  const [userInput, setUserInput] = useState('')
  const [confirmId, setConfirmId] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (!diskId) return
    setBusy(true)
    try {
      setTeams(await fetchDiskTeams(diskId))
    } catch {
      /* */
    } finally {
      setBusy(false)
    }
  }, [diskId])

  useEffect(() => {
    void load()
  }, [load])

  const addTeam = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!diskId || !newName.trim()) return
    try {
      await createDiskTeam(diskId, newName.trim())
      success('Team created', newName.trim())
      setNewName('')
      void load()
      onChanged()
    } catch (e: any) {
      failure('Create failed', e.message)
    }
  }

  const saveTeam = async () => {
    if (!editing) return
    try {
      await updateDiskTeam(editing.id, { name: editing.name, users: editing.users })
      success('Team updated', editing.name)
      setEditing(null)
      void load()
      onChanged()
    } catch (e: any) {
      failure('Update failed', e.message)
    }
  }

  const delTeam = async (id: number) => {
    try {
      await deleteDiskTeam(id)
      success('Team deleted')
      void load()
      onChanged()
    } catch (e: any) {
      failure('Delete failed', e.message)
    }
  }

  const addUser = () => {
    if (!editing) return
    const names = userInput
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (names.length === 0) return
    const existing = new Set(editing.users)
    for (const n of names) existing.add(n)
    setEditing({ ...editing, users: [...existing] })
    setUserInput('')
  }

  const removeUser = (u: string) => {
    if (!editing) return
    setEditing({ ...editing, users: editing.users.filter((x) => x !== u) })
  }

  return (
    <Dialog
      open={diskId !== null}
      onOpenChange={() => {
        if (!editing) onClose()
      }}
    >
      <DialogContent className="sm:max-w-[500px] max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-4" />
            Teams — {diskName}
          </DialogTitle>
        </DialogHeader>

        {busy ? (
          <p className="text-xs text-muted-foreground py-4 text-center">Loading…</p>
        ) : teams.length === 0 && !editing ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No teams yet for this disk.</p>
        ) : null}

        {!editing && (
          <>
            <div className="space-y-2">
              {teams.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded-md border border-border/50 px-3 py-2 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{t.name}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {t.users.length > 0 ? t.users.join(', ') : 'No users'}
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0 ml-2">
                    <Button variant="ghost" size="sm" onClick={() => setEditing({ ...t })}>
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmId(t.id)}>
                      <Trash2 className="size-3 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <form onSubmit={addTeam} className="flex gap-2 pt-2">
              <Input
                placeholder="New team name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="flex-1"
              />
              <Button type="submit" size="sm" disabled={!newName.trim()}>
                Add
              </Button>
            </form>
          </>
        )}

        {editing && (
          <div className="space-y-3">
            <Input
              placeholder="Team name"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  saveTeam()
                }
              }}
            />

            <div>
              <p className="text-xs font-medium mb-1 text-muted-foreground">Users</p>
              <div className="flex flex-wrap gap-1 mb-2">
                {editing.users.length === 0 && (
                  <span className="text-[11px] text-muted-foreground italic">No users</span>
                )}
                {editing.users.map((u) => (
                  <span key={u} className="inline-flex items-center gap-1 rounded-sm bg-muted px-2 py-0.5 text-[11px]">
                    {u}
                    <button
                      onClick={() => removeUser(u)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Trash2 className="size-2.5" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Add users (comma separated)"
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addUser()
                    }
                  }}
                  className="flex-1"
                />
                <Button size="sm" variant="outline" onClick={addUser} disabled={!userInput.trim()}>
                  Add
                </Button>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={saveTeam}>
                Save
              </Button>
            </div>
          </div>
        )}

        <ConfirmDialog
          open={confirmId !== null}
          onOpenChange={() => setConfirmId(null)}
          title="Delete Team"
          description="Remove this team and its user list? This cannot be undone."
          action="Delete"
          onConfirm={() => {
            if (confirmId !== null) delTeam(confirmId)
            setConfirmId(null)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

// ── Backup & Restore ─────────────────────────────────────────────────

function BackupPanel() {
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [restoreName, setRestoreName] = useState<string | null>(null)
  const [deleteName, setDeleteName] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setBackups(await fetchBackups())
    } catch {
      /* */
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const doBackup = async () => {
    try {
      await createBackup()
      success('Backup created')
      await load()
    } catch (e: any) {
      failure('Backup failed', e.message)
    }
  }

  const doRestore = async () => {
    if (!restoreName) return
    try {
      await restoreBackup(restoreName)
      success('Backup restored', restoreName)
      setRestoreName(null)
    } catch (e: any) {
      failure('Restore failed', e.message)
    }
  }

  const doDelete = async () => {
    if (!deleteName) return
    try {
      await deleteBackup(deleteName)
      success('Backup deleted')
      setDeleteName(null)
      await load()
    } catch (e: any) {
      failure('Delete failed', e.message)
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 py-3">
        <CardTitle className="text-sm">Backups · {backups.length}</CardTitle>
        <Button size="sm" onClick={doBackup}>
          <Archive className="size-3.5 mr-1" />
          Create Backup
        </Button>
      </CardHeader>
      <CardContent>
        {backups.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No backups yet.</p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-border text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="py-2">Name</th>
                  <th className="py-2">Date</th>
                  <th className="py-2">Size</th>
                  <th className="py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.name} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                    <td className="py-2 font-mono text-[11px]">{b.name}</td>
                    <td className="py-2 text-xs text-muted-foreground">{b.mtime.slice(0, 19).replace('T', ' ')}</td>
                    <td className="py-2 text-xs text-muted-foreground">{formatBytes(b.size)}</td>
                    <td className="py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setRestoreName(b.name)} title="Restore">
                          <RotateCcw className="size-3" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setDeleteName(b.name)}>
                          <Trash2 className="size-3 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        open={restoreName !== null}
        onOpenChange={() => setRestoreName(null)}
        title="Restore Backup"
        description={`Restore '${restoreName}'? This will replace the current admin database. A new backup will be created automatically before restoring.`}
        action="Restore"
        onConfirm={doRestore}
      />

      <ConfirmDialog
        open={deleteName !== null}
        onOpenChange={() => setDeleteName(null)}
        title="Delete Backup"
        description={`Delete '${deleteName}'?`}
        action="Delete"
        onConfirm={doDelete}
      />
    </Card>
  )
}

// ── Profile ──────────────────────────────────────────────────────────

function ProfilePanel({ user }: { user: AuthInfo['user'] }) {
  const [cp, setCp] = useState('')
  const [np, setNp] = useState('')
  const [msg, setMsg] = useState('')
  const go = async (e: React.FormEvent) => {
    e.preventDefault()
    if (np.length < 10) {
      setMsg('Password must be at least 10 characters')
      return
    }
    try {
      await changeOwnPassword(cp, np)
      success('Password changed')
      setMsg('Password changed.')
      setCp('')
      setNp('')
    } catch (e: any) {
      setMsg(e.message)
      failure('Password change failed', e.message)
    }
  }
  if (!user) return null
  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-sm">Profile</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-muted">
            <User className="size-4 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium">{user.username}</p>
            <Badge variant={user.role === 'owner' ? 'default' : 'secondary'} className="text-[10px] mt-0.5">
              {user.role}
            </Badge>
          </div>
        </div>
        <Separator />
        <form onSubmit={go} className="space-y-3 max-w-sm">
          <h4 className="text-sm font-medium">Change Password</h4>
          {msg && (
            <p
              className={`rounded-sm px-3 py-2 text-xs ${msg.includes('changed') ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'}`}
            >
              {msg}
            </p>
          )}
          <PwInput placeholder="Current password" value={cp} onChange={setCp} />
          <PwInput placeholder="New password (min 10 chars)" value={np} onChange={setNp} />
          <Button type="submit" disabled={!cp || np.length < 10}>
            Change Password
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

// ── Main ────────────────────────────────────────────────────────────

export function AdminTab() {
  const [auth, setAuth] = useState<AuthInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<SummaryStats | null>(null)

  const check = useCallback(async () => {
    try {
      const a = await fetchAuthStatus()
      setAuth(a)
      if (a.loggedIn) {
        fetchStats()
          .then(setStats)
          .catch(() => {})
      }
    } catch {
      /* */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void check()
  }, [check])

  if (loading)
    return (
      <div className="max-w-3xl mx-auto p-6 space-y-4 animate-fade-in w-full">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-full bg-muted animate-pulse" />
          <div className="space-y-2 flex-1">
            <div className="h-4 w-32 rounded-sm bg-muted animate-pulse" />
            <div className="h-3 w-20 rounded-sm bg-muted animate-pulse" />
          </div>
        </div>
        <div className="h-24 rounded-sm bg-muted animate-pulse" />
        <div className="h-48 rounded-sm bg-muted animate-pulse" />
      </div>
    )
  if (auth?.needsSetup)
    return (
      <SetupForm
        onDone={(u) =>
          setAuth({ loggedIn: true, user: u, needsSetup: false, rateLimit: { captcha: false, attempts: 0 } })
        }
      />
    )
  if (!auth?.loggedIn)
    return (
      <LoginForm
        onLogin={(u) => setAuth({ loggedIn: true, user: u, needsSetup: false, rateLimit: auth!.rateLimit })}
        rateLimit={auth!.rateLimit}
      />
    )

  const isOwner = auth.user?.role === 'owner'

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4 animate-fade-in w-full">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Admin</h2>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>
            {auth.user?.username} · {auth.user?.role}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await logout()
              success('Signed out')
            }}
          >
            <LogOut className="size-3.5 mr-1" />
            Sign out
          </Button>
        </div>
      </div>

      {stats && <StatsBar stats={stats} />}

      <Tabs defaultValue="spaces">
        <TabsList>
          <TabsTrigger value="spaces">
            <HardDrive className="size-3.5 mr-1.5" />
            Disk Mapping
          </TabsTrigger>
          {isOwner && (
            <TabsTrigger value="accounts">
              <Shield className="size-3.5 mr-1.5" />
              Accounts
            </TabsTrigger>
          )}
          <TabsTrigger value="backups">
            <Archive className="size-3.5 mr-1.5" />
            Backups
          </TabsTrigger>
          <TabsTrigger value="profile">
            <User className="size-3.5 mr-1.5" />
            Profile
          </TabsTrigger>
        </TabsList>
        <TabsContent value="spaces">
          <SpacesPanel />
        </TabsContent>
        {isOwner && (
          <TabsContent value="accounts">
            <AccountsPanel />
          </TabsContent>
        )}
        <TabsContent value="backups">
          <BackupPanel />
        </TabsContent>
        <TabsContent value="profile">
          <ProfilePanel user={auth.user} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
