import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Shield, User, LogOut, HardDrive, Users, Key, Archive } from 'lucide-react'
import { success } from '@/lib/toast.js'
import { fetchAuthStatus, fetchCaptcha, login, logout, onAuthInvalid, setup, type AuthInfo } from '@/lib/adminApi.js'
import { SpacesPanel, GroupConfigPanel, AccountsPanel, BackupsPanel, ChangePasswordPanel } from './AdminModals.js'

export function AdminButton({ collapsed }: { collapsed: boolean }) {
  const [auth, setAuth] = useState<AuthInfo | null>(null)
  const [showLogin, setShowLogin] = useState(false)
  const [showAdmin, setShowAdmin] = useState(false)
  // The Disk Mapping editor holds unsaved edits in local state, so closing the
  // dialog throws them away silently. It reports its dirty flag up here so the
  // close can be intercepted.
  const [dirty, setDirty] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const check = useCallback(async () => {
    try {
      setAuth(await fetchAuthStatus())
    } catch {
      /* */
    }
  }, [])
  useEffect(() => {
    void check()
  }, [check])

  // A session that expires mid-use (401 anywhere in the admin area) must close
  // the admin dialog and fall back to the login button rather than keep showing
  // stale admin state.
  useEffect(() => {
    return onAuthInvalid(() => {
      setShowAdmin(false)
      setShowLogin(false)
      void check()
    })
  }, [check])

  const doLogin = async (username: string, password: string, captchaId?: string, captchaAnswer?: number) => {
    const u = await login(username, password, captchaId, captchaAnswer)
    success('Signed in')
    setAuth({ ...auth!, loggedIn: true, user: u, needsSetup: false })
    setShowLogin(false)
  }

  const doLogout = async () => {
    try {
      await logout()
      success('Signed out')
    } catch {
      /* */
    }
    setAuth({ ...auth!, loggedIn: false, user: null })
    setShowAdmin(false)
  }

  if (!auth)
    return (
      <button
        className="inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground opacity-40"
        disabled
      >
        <Shield className="size-3.5" />
        {!collapsed && 'Admin'}
      </button>
    )

  if (auth.needsSetup)
    return (
      <SetupButton
        collapsed={collapsed}
        onDone={(u) => setAuth({ ...auth, loggedIn: true, user: u, needsSetup: false })}
      />
    )

  if (!auth.loggedIn)
    return (
      <>
        <button
          onClick={() => setShowLogin(true)}
          className="inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-white/[0.04] transition-colors"
          title="Admin Login"
        >
          <Shield className="size-3.5" />
          {!collapsed && 'Login'}
        </button>
        <Dialog open={showLogin} onOpenChange={setShowLogin}>
          <DialogContent className="sm:max-w-[360px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Shield className="size-4" />
                Admin Login
              </DialogTitle>
            </DialogHeader>
            <LoginForm onLogin={doLogin} rateLimit={auth.rateLimit} />
          </DialogContent>
        </Dialog>
      </>
    )

  const isOwner = auth.user?.role === 'owner'

  return (
    <>
      <button
        onClick={() => setShowAdmin(true)}
        className="inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-white/[0.04] transition-colors"
        title={auth.user?.username ?? 'Admin'}
      >
        <User className="size-3.5" />
        {!collapsed && <span className="truncate max-w-[80px]">{auth.user?.username}</span>}
      </button>

      <Dialog
        open={showAdmin}
        onOpenChange={(v) => {
          // Closing with unsaved Disk Mapping edits discards them; ask first.
          if (!v && dirty) {
            setConfirmDiscard(true)
            return
          }
          setShowAdmin(v)
        }}
      >
        <DialogContent className="sm:max-w-[900px] h-[90vh] max-h-[90vh] flex flex-col">
          <DialogHeader>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pr-6">
              <DialogTitle className="flex items-center gap-2">
                <Shield className="size-4" />
                Admin
              </DialogTitle>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="truncate max-w-[180px]">
                  {auth.user?.username} · {auth.user?.role}
                </span>
                <button
                  onClick={doLogout}
                  title="Sign out"
                  className="inline-flex min-h-6 items-center gap-1 rounded-sm px-1.5 py-1 text-destructive ring-offset-background transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <LogOut className="size-3" />
                  Sign out
                </button>
              </div>
            </div>
          </DialogHeader>
          <Tabs defaultValue="spaces" className="flex-1 flex flex-col min-h-0">
            <TabsList className="mb-3 h-auto w-full flex-wrap justify-start gap-1">
              <TabsTrigger value="spaces">
                <HardDrive className="size-3.5 mr-1.5" />
                Disk Mapping
              </TabsTrigger>
              <TabsTrigger value="groups">
                <Users className="size-3.5 mr-1.5" />
                Group Config
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
              <TabsTrigger value="password">
                <Key className="size-3.5 mr-1.5" />
                Password
              </TabsTrigger>
            </TabsList>
            <div className="flex-1 min-h-0 overflow-auto">
              <TabsContent value="spaces" className="mt-0 h-full">
                <SpacesPanel onDirtyChange={setDirty} />
              </TabsContent>
              <TabsContent value="groups" className="mt-0 h-full">
                <GroupConfigPanel />
              </TabsContent>
              {isOwner && (
                <TabsContent value="accounts" className="mt-0">
                  <AccountsPanel />
                </TabsContent>
              )}
              <TabsContent value="backups" className="mt-0">
                <BackupsPanel />
              </TabsContent>
              <TabsContent value="password" className="mt-0">
                <ChangePasswordPanel user={auth.user} onClose={() => setShowAdmin(false)} />
              </TabsContent>
            </div>
          </Tabs>

          {/* Inside DialogContent on purpose: the dialog renders through a
              portal appended to <body>, so an alert placed outside it lands
              earlier in the DOM and the dialog overlay swallows its clicks. */}
          <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
                <AlertDialogDescription>
                  The Disk Mapping editor has changes that have not been saved. Closing now throws them away.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setConfirmDiscard(false)}>Keep editing</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    setConfirmDiscard(false)
                    setDirty(false)
                    setShowAdmin(false)
                  }}
                >
                  Discard
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </DialogContent>
      </Dialog>
    </>
  )
}

function SetupButton({ collapsed, onDone }: { collapsed: boolean; onDone: (u: AuthInfo['user']) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-[var(--emerald-400)] hover:text-[var(--emerald-500)] hover:bg-emerald-500/10 transition-colors"
        title="Setup Admin"
      >
        <Shield className="size-3.5" />
        {!collapsed && 'Setup'}
      </button>
      <SetupModal open={open} onOpenChange={setOpen} onDone={onDone} />
    </>
  )
}

function SetupModal({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onDone: (u: AuthInfo['user']) => void
}) {
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
      setU('')
      setP('')
      onOpenChange(false)
      success('Owner created')
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[360px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="size-4" />
            Initial Setup
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={go} className="space-y-3">
          <p className="text-xs text-muted-foreground">Create the first admin account. You will be the owner.</p>
          {err && <div className="rounded-sm bg-destructive/10 px-3 py-2 text-xs text-destructive">{err}</div>}
          <Input placeholder="Username" value={u} onChange={(e) => setU(e.target.value)} autoFocus />
          <Input
            type="password"
            placeholder="Password (min 10 chars)"
            value={p}
            onChange={(e) => setP(e.target.value)}
          />
          <Button type="submit" className="w-full" disabled={busy || !u || p.length < 10}>
            {busy ? 'Creating…' : 'Create Admin'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function LoginForm({
  onLogin,
  rateLimit,
}: {
  onLogin: (u: string, p: string, cId?: string, cAns?: number) => Promise<void>
  rateLimit: AuthInfo['rateLimit']
}) {
  const [u, setU] = useState('')
  const [p, setP] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [captcha, setCaptcha] = useState<{ id: string; question: string } | null>(null)
  const [captchaAnswer, setCaptchaAnswer] = useState('')
  const showCaptcha = rateLimit.captcha || captcha !== null
  const loadCaptcha = useCallback(async () => {
    try {
      setCaptcha(await fetchCaptcha())
    } catch {
      /* */
    }
  }, [])
  useEffect(() => {
    if (rateLimit.captcha) void loadCaptcha()
  }, [rateLimit.captcha, loadCaptcha])
  const go = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      await onLogin(u, p, captcha?.id, captchaAnswer ? Number(captchaAnswer) : undefined)
    } catch (e: any) {
      setErr(e.message)
      if (!captcha) void loadCaptcha()
      setBusy(false)
    }
  }
  const remaining = Math.max(0, 10 - rateLimit.attempts)
  return (
    <div>
      {rateLimit.attempts > 0 &&
        (showCaptcha ? (
          <div className="mb-3 rounded-sm px-3 py-2 text-xs bg-amber-400/10 text-foreground">
            Rate limit near: {remaining} attempts remaining
          </div>
        ) : (
          <div className="mb-3 rounded-sm px-3 py-2 text-xs bg-muted text-muted-foreground">
            Remaining attempts: {remaining}
          </div>
        ))}
      {err && <div className="mb-3 rounded-sm bg-destructive/10 px-3 py-2 text-xs text-destructive">{err}</div>}
      <form onSubmit={go} className="space-y-3">
        <Input
          placeholder="Username"
          value={u}
          onChange={(e) => setU(e.target.value)}
          autoFocus
          autoComplete="username"
        />
        <Input
          type="password"
          placeholder="Password"
          value={p}
          onChange={(e) => setP(e.target.value)}
          autoComplete="current-password"
        />
        {showCaptcha && captcha && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">{captcha.question}</p>
            <Input
              placeholder="Answer"
              value={captchaAnswer}
              onChange={(e) => setCaptchaAnswer(e.target.value)}
              inputMode="numeric"
              autoComplete="off"
            />
          </div>
        )}
        <Button type="submit" className="w-full" disabled={busy || !u || !p || (showCaptcha && !captchaAnswer)}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  )
}
