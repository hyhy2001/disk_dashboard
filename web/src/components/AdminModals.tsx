import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
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
import {
  Plus,
  Trash2,
  Key,
  HardDrive,
  EyeOff,
  Archive,
  RotateCcw,
  Eye,
  X,
  User,
  Upload,
  Download,
  Copy,
  Pencil,
} from 'lucide-react'
import { success, failure } from '@/lib/toast.js'
import { clearApiCache } from '@/lib/api.js'
import {
  createAccount,
  deleteAccount,
  fetchAccounts,
  fetchDiskTeams,
  createDiskTeam,
  updateDiskTeam,
  deleteDiskTeam,
  importDiskTeams,
  fetchDiskUsers,
  fetchSpaces,
  resetAccountPassword,
  saveSpaceLayout,
  fetchBackups,
  createBackup,
  restoreBackup,
  deleteBackup,
  changeOwnPassword,
  testDiskRead,
  type AuthInfo,
  type BackupInfo,
  type DiskReadTest,
} from '../lib/adminApi.js'

function formatBytes(n: number): string {
  return n < 1024 ? `${n}B` : n < 1048576 ? `${(n / 1024).toFixed(0)}KB` : `${(n / 1048576).toFixed(1)}MB`
}

function PwInput(p: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <Input
        type={show ? 'text' : 'password'}
        placeholder={p.placeholder}
        value={p.value}
        onChange={(e) => p.onChange(e.target.value)}
        autoFocus={p.autoFocus}
        className="pr-9"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Hide password' : 'Show password'}
        aria-pressed={show}
        title={show ? 'Hide password' : 'Show password'}
        className="absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
        tabIndex={-1}
      >
        {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </button>
    </div>
  )
}

function ConfirmDialog(p: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  description: string
  action: string
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={p.open} onOpenChange={p.onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{p.title}</AlertDialogTitle>
          <AlertDialogDescription>{p.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={p.onConfirm}
            className="bg-destructive text-destructive-foreground hover:opacity-90"
          >
            {p.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function genKey(): string {
  return Math.random().toString(36).slice(2, 8)
}

// ── Export: Panel (no Dialog wrapper) + Dialog (with wrapper) ───────

export function SpacesPanel(p: { onDirtyChange?: (dirty: boolean) => void }) {
  return <SpacesContent onDirtyChange={p.onDirtyChange} />
}
export function GroupConfigPanel() {
  return <GroupConfigContent />
}
export function AccountsPanel() {
  return <AccountsContent />
}
export function BackupsPanel() {
  return <BackupsContent />
}
export function ChangePasswordPanel(p: { user: AuthInfo['user'] | null; onClose: () => void }) {
  return <ChangePasswordContent {...p} />
}

export function SpacesDialog(p: { open: boolean; onClose: () => void }) {
  return !p.open ? null : (
    <Dialog open onOpenChange={p.onClose}>
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] flex flex-col">
        <SpacesContent />
      </DialogContent>
    </Dialog>
  )
}
export function AccountsDialog(p: { open: boolean; onClose: () => void }) {
  return !p.open ? null : (
    <Dialog open onOpenChange={p.onClose}>
      <DialogContent className="sm:max-w-[550px] max-h-[80vh] overflow-auto">
        <AccountsContent />
      </DialogContent>
    </Dialog>
  )
}
export function BackupsDialog(p: { open: boolean; onClose: () => void }) {
  return !p.open ? null : (
    <Dialog open onOpenChange={p.onClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-auto">
        <BackupsContent />
      </DialogContent>
    </Dialog>
  )
}
export function GroupConfigDialog(p: { open: boolean; onClose: () => void }) {
  return !p.open ? null : (
    <Dialog open onOpenChange={p.onClose}>
      <DialogContent className="sm:max-w-[900px] max-h-[90vh] flex flex-col">
        <GroupConfigContent />
      </DialogContent>
    </Dialog>
  )
}
export function ChangePasswordDialog(p: { open: boolean; onClose: () => void; user: AuthInfo['user'] | null }) {
  return !p.open ? null : (
    <Dialog open onOpenChange={p.onClose}>
      <DialogContent className="sm:max-w-[380px]">
        <ChangePasswordContent user={p.user} onClose={p.onClose} />
      </DialogContent>
    </Dialog>
  )
}

// ── Spaces Content ──────────────────────────────────────────────────

/** A space or disk as the editor holds it: server fields plus a local react key. */
interface EditDisk {
  id?: number
  slug?: string
  name: string
  path: string
  _key: string
}
interface EditSpace {
  id?: number
  name: string
  disks: EditDisk[]
  _key: string
}

/** One human-readable difference between the loaded layout and the edited one. */
interface Change {
  kind: 'added' | 'removed' | 'renamed' | 'moved'
  what: string
}

/**
 * Compare the saved layout against the edited one.
 *
 * The old code did `JSON.stringify(a) !== JSON.stringify(b) ? 1 : 0`, so the
 * "Changes" figure was a yes/no flag wearing a number's clothing — three edits
 * still read "1" — and "Show Diff" had nothing to list because no list was ever
 * computed. Diffing by identity gives both the honest count and the lines.
 */
function diffLayout(baseline: EditSpace[], current: EditSpace[]): Change[] {
  const changes: Change[] = []
  const baseById = new Map(baseline.filter((s) => s.id !== undefined).map((s) => [s.id, s]))
  const curById = new Map(current.filter((s) => s.id !== undefined).map((s) => [s.id, s]))

  for (const space of baseline) {
    if (space.id !== undefined && !curById.has(space.id)) {
      changes.push({ kind: 'removed', what: `space “${space.name}”` })
    }
  }

  for (const space of current) {
    const before = space.id !== undefined ? baseById.get(space.id) : undefined
    if (!before) {
      changes.push({ kind: 'added', what: `space “${space.name || 'unnamed'}”` })
      for (const disk of space.disks) {
        changes.push({ kind: 'added', what: `disk “${disk.name || 'unnamed'}”` })
      }
      continue
    }
    if (before.name !== space.name) {
      changes.push({ kind: 'renamed', what: `space “${before.name}” → “${space.name}”` })
    }
    const beforeDisks = new Map(before.disks.filter((d) => d.id !== undefined).map((d) => [d.id, d]))
    const currentDiskIds = new Set(space.disks.map((d) => d.id).filter((id) => id !== undefined))
    for (const disk of before.disks) {
      if (disk.id !== undefined && !currentDiskIds.has(disk.id)) {
        changes.push({ kind: 'removed', what: `disk “${disk.name}”` })
      }
    }
    for (const disk of space.disks) {
      const diskBefore = disk.id !== undefined ? beforeDisks.get(disk.id) : undefined
      if (!diskBefore) {
        changes.push({ kind: 'added', what: `disk “${disk.name || 'unnamed'}” in “${space.name}”` })
        continue
      }
      if (diskBefore.name !== disk.name) {
        changes.push({ kind: 'renamed', what: `disk “${diskBefore.name}” → “${disk.name}”` })
      }
      if (diskBefore.path !== disk.path) {
        changes.push({ kind: 'moved', what: `path of “${disk.name}” → ${disk.path || '(empty)'}` })
      }
    }
  }
  return changes
}

/**
 * Reasons the current layout cannot be saved.
 *
 * Save used to be enabled whenever anything differed, so blanking a name or a
 * path sent the request anyway and the failure only surfaced from the API —
 * after, under the old per-entity save loop, earlier disks had already been
 * written. Checking here keeps the button honest about what it will do.
 */
function layoutProblems(spaces: EditSpace[]): string[] {
  const problems: string[] = []
  for (const space of spaces) {
    if (!space.name.trim()) problems.push('A space is missing its name')
    const seen = new Set<string>()
    for (const disk of space.disks) {
      if (!disk.name.trim()) problems.push(`A disk in “${space.name || 'unnamed space'}” is missing its name`)
      if (!disk.path.trim()) problems.push(`“${disk.name || 'A disk'}” is missing its path`)
      const key = disk.name.trim().toLowerCase()
      if (key && seen.has(key)) problems.push(`“${space.name}” has two disks named “${disk.name}”`)
      seen.add(key)
    }
  }
  return [...new Set(problems)]
}

function SpacesContent({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const [spaces, setSpaces] = useState<EditSpace[]>([])
  const [baseline, setBaseline] = useState<EditSpace[]>([])
  const [saving, setSaving] = useState(false)
  const [showDiff, setShowDiff] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [restoreName, setRestoreName] = useState<string | null>(null)
  const [testBusyKey, setTestBusyKey] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, DiskReadTest>>({})
  const [confirmDeleteSpace, setConfirmDeleteSpace] = useState<number | null>(null)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const nameInputs = useRef<Record<string, HTMLInputElement | null>>({})

  const load = useCallback(async () => {
    const raw = await fetchSpaces()
    const sp: EditSpace[] = raw.map((s: any) => ({
      ...s,
      _key: genKey(),
      disks: s.disks.map((d: any) => ({ ...d, _key: genKey() })),
    }))
    setSpaces(sp)
    setBaseline(JSON.parse(JSON.stringify(sp)))
    try {
      setBackups(await fetchBackups())
    } catch {
      /* backups are optional */
    }
  }, [])
  useEffect(() => {
    void load()
  }, [])

  /** Probe one disk path on the server (readonly) so a mapping is verified before save. */
  const runDiskTest = async (key: string, path: string) => {
    if (!path.trim()) return
    setTestBusyKey(key)
    try {
      const result = await testDiskRead(path)
      setTestResult((r) => ({ ...r, [key]: result }))
    } catch (e: any) {
      setTestResult((r) => ({ ...r, [key]: { path, reportFound: false, reportReadable: false, message: e.message } }))
    } finally {
      setTestBusyKey(null)
    }
  }

  const changeList = useMemo(() => diffLayout(baseline, spaces), [baseline, spaces])
  const changes = changeList.length
  const problems = useMemo(() => (changes > 0 ? layoutProblems(spaces) : []), [spaces, changes])
  const totalDisks = spaces.reduce((s: number, sp) => s + sp.disks.length, 0)

  // The parent dialog blocks its own close while edits are pending, so it has to
  // know. Reported through an effect rather than during render so the parent's
  // state update never happens mid-render of this child.
  useEffect(() => {
    onDirtyChange?.(changes > 0)
  }, [changes, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  const save = async () => {
    setSaving(true)
    try {
      // One transactional request: the server applies all of it or none of it.
      const saved = await saveSpaceLayout(
        spaces.map((s) => ({
          ...(s.id !== undefined ? { id: s.id } : {}),
          name: s.name,
          disks: s.disks.map((d) => ({ ...(d.id !== undefined ? { id: d.id } : {}), name: d.name, path: d.path })),
        })),
      )
      const next: EditSpace[] = saved.map((s: any) => ({
        ...s,
        _key: genKey(),
        disks: s.disks.map((d: any) => ({ ...d, _key: genKey() })),
      }))
      setSpaces(next)
      setBaseline(JSON.parse(JSON.stringify(next)))
      clearApiCache()
      success('Saved', `${changes} change${changes !== 1 ? 's' : ''} applied`)
    } catch (e: any) {
      // Nothing was written, so the editor keeps the user's edits rather than
      // reloading them away — they can fix the problem and save again.
      failure('Save failed — nothing was changed', e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col min-h-0">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-3 text-xs">
        <div className="rounded border border-border/50 px-3 py-2">
          <span className="text-muted-foreground">Spaces</span>
          <span className="float-right font-semibold">{spaces.length}</span>
        </div>
        <div className="rounded border border-border/50 px-3 py-2">
          <span className="text-muted-foreground">Disks</span>
          <span className="float-right font-semibold">{totalDisks}</span>
        </div>
        <div className="rounded border border-border/50 px-3 py-2">
          <span className="text-muted-foreground">Backups</span>
          <span className="float-right font-semibold">{backups.length}</span>
        </div>
        <div
          className={`rounded border px-3 py-2 ${changes ? 'border-amber-400/30 bg-amber-400/5' : 'border-border/50'}`}
        >
          <span className="text-muted-foreground">Changes</span>
          <span className={`float-right font-semibold ${changes ? 'text-[var(--amber-400)]' : ''}`}>{changes}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Button size="sm" onClick={() => setSpaces((s) => [...s, { name: 'New Space', disks: [], _key: genKey() }])}>
          <Plus className="size-3.5 mr-1" />
          Add Space
        </Button>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          <RotateCcw className="size-3 mr-1" />
          Reload
        </Button>
        <Button size="sm" variant="outline" onClick={() => setShowDiff((s) => !s)} aria-expanded={showDiff}>
          {showDiff ? 'Hide Diff' : 'Show Diff'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setShowRaw((s) => !s)} aria-expanded={showRaw}>
          Raw JSON
        </Button>
        <div className="flex-1" />
        <Button
          size="sm"
          onClick={() => void save()}
          disabled={!changes || saving || problems.length > 0}
          title={problems[0] ?? (changes ? `Save ${changes} change${changes !== 1 ? 's' : ''}` : 'No changes to save')}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
      {problems.length > 0 && (
        <div className="mb-3 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <p className="font-semibold">Cannot save yet</p>
          <ul className="mt-1 list-disc pl-4 space-y-0.5">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="space-y-3 overflow-auto flex-1 min-h-0 pr-1">
        {spaces.map((sp, spIdx: number) => (
          <div key={sp._key || sp.id} className="rounded-lg border border-border/60">
            <div className="flex items-center gap-2 bg-muted/20 px-3 py-2 border-b border-border/40">
              <HardDrive className="size-3.5 text-muted-foreground shrink-0" />
              <input
                ref={(el) => {
                  nameInputs.current[sp._key] = el
                }}
                value={sp.name}
                onChange={(e) => {
                  const c = [...spaces]
                  c[spIdx] = { ...c[spIdx]!, name: e.target.value }
                  setSpaces(c)
                }}
                className="flex-1 min-w-0 bg-transparent text-sm font-medium border-none outline-none focus:ring-0 focus-visible:bg-muted/40 focus-visible:rounded-sm focus-visible:px-0.5 p-0"
                placeholder="Space name"
                aria-label={`Space name${sp.name ? `: ${sp.name}` : ''}`}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const el = nameInputs.current[sp._key]
                  el?.focus()
                  el?.select()
                }}
                aria-label={`Rename ${sp.name || 'space'}`}
                title="Rename space"
              >
                <Pencil className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const c = [...spaces]
                  c[spIdx] = { ...c[spIdx]!, disks: [...c[spIdx]!.disks, { name: '', path: '', _key: genKey() }] }
                  setSpaces(c)
                }}
                aria-label={`Add a disk to ${sp.name || 'space'}`}
                title="Add disk"
              >
                <Plus className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  // An unsaved space has nothing to lose, so it goes without a
                  // prompt; a saved one asks, through the same dialog every other
                  // destructive action in here uses rather than window.confirm.
                  if (sp.id === undefined) setSpaces((s) => s.filter((_, i: number) => i !== spIdx))
                  else setConfirmDeleteSpace(spIdx)
                }}
                className="text-destructive"
                aria-label={`Delete ${sp.name || 'space'} and its disks`}
                title="Delete space"
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
            <div className="px-3 py-2 space-y-2">
              {sp.disks.map((d, dIdx: number) => (
                <div key={d._key} className="rounded-sm bg-muted/10 border border-border/30 px-2 py-1.5">
                  {/* Wraps below sm: name, path and two buttons on one row need
                      ~360px, and on a phone the delete button was pushed past the
                      dialog's right edge. */}
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={d.name}
                      onChange={(e) => {
                        const c = [...spaces]
                        c[spIdx]!.disks[dIdx] = { ...c[spIdx]!.disks[dIdx]!, name: e.target.value }
                        setSpaces(c)
                      }}
                      className="min-w-0 flex-1 basis-[45%] bg-muted/20 rounded-sm px-2 py-1 text-xs border border-border/30 outline-none focus:border-emerald-500/40 transition-colors"
                      placeholder="Display name"
                      aria-label="Disk display name"
                    />
                    <input
                      value={d.path}
                      onChange={(e) => {
                        const c = [...spaces]
                        c[spIdx]!.disks[dIdx] = { ...c[spIdx]!.disks[dIdx]!, path: e.target.value }
                        setSpaces(c)
                      }}
                      className="min-w-0 flex-[2] basis-full sm:basis-auto bg-muted/20 rounded-sm px-2 py-1 text-xs font-mono border border-border/30 outline-none focus:border-emerald-500/40 transition-colors"
                      placeholder="Path to report.db"
                      aria-label="Path to the directory holding report.db"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[12px] shrink-0"
                      onClick={() => void runDiskTest(d._key, d.path)}
                      disabled={!d.path.trim() || testBusyKey === d._key}
                      title="Check that a report can be read from this path"
                    >
                      {testBusyKey === d._key ? 'Testing…' : 'Test read'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const c = [...spaces]
                        c[spIdx]!.disks = c[spIdx]!.disks.filter((_, i: number) => i !== dIdx)
                        setSpaces(c)
                      }}
                      className="text-destructive shrink-0"
                      aria-label={`Remove disk ${d.name || '(unnamed)'}`}
                      title="Remove disk"
                    >
                      <X className="size-3" />
                    </Button>
                  </div>
                  {testResult[d._key] && (
                    <div
                      className={`mt-1.5 text-[12px] font-mono ${
                        testResult[d._key]!.reportReadable ? 'text-[var(--emerald-500)]' : 'text-[var(--rose-400)]'
                      }`}
                    >
                      {testResult[d._key]!.reportReadable
                        ? `✓ ${testResult[d._key]!.totalFiles} files · ${testResult[d._key]!.scanRoot ?? 'no scan_root'}`
                        : `✗ ${testResult[d._key]!.message ?? 'not readable'}`.replace(testResult[d._key]!.path, '…')}
                    </div>
                  )}
                  {d.id && d.slug && (
                    <div className="flex items-center gap-2 mt-1.5 text-[12px] text-muted-foreground">
                      <code className="font-mono">
                        /{sp.name || 'space'}/{d.slug}/overview
                      </code>
                      <button
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(`/${sp.name || 'space'}/${d.slug}/overview`)
                            success('Link copied')
                          } catch {
                            failure('Copy failed')
                          }
                        }}
                        aria-label={`Copy the public link for ${d.name || 'this disk'}`}
                        title="Copy public link"
                        className="flex size-6 shrink-0 items-center justify-center rounded transition-colors hover:text-foreground"
                      >
                        <Copy className="size-3" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {showDiff && changes > 0 && (
        <div className="mt-3 rounded border border-border/50 p-3 text-xs max-h-32 overflow-auto">
          <p className="font-semibold text-muted-foreground mb-1">
            {changes} change{changes !== 1 ? 's' : ''}
          </p>
          {/* The panel used to print only that count — a "Show Diff" button that
              showed no diff. */}
          <ul className="space-y-0.5">
            {changeList.map((c, i) => (
              <li key={`${c.kind}-${c.what}-${i}`} className="flex gap-2">
                <span
                  className={
                    c.kind === 'added'
                      ? 'text-[var(--emerald-400)] w-14 shrink-0'
                      : c.kind === 'removed'
                        ? 'text-destructive w-14 shrink-0'
                        : 'text-[var(--amber-400)] w-14 shrink-0'
                  }
                >
                  {c.kind}
                </span>
                <span className="min-w-0 break-words">{c.what}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {showRaw && (
        <details className="mt-2">
          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">Raw JSON</summary>
          <pre className="mt-1 text-[12px] font-mono bg-muted/20 rounded p-2 max-h-32 overflow-auto text-muted-foreground">
            {JSON.stringify(
              spaces.map((s) => ({
                name: s.name,
                disks: s.disks.map((d) => ({ name: d.name, path: d.path })),
              })),
              null,
              2,
            )}
          </pre>
        </details>
      )}
      <div className="mt-3 pt-3 border-t border-border/40 flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            try {
              await createBackup()
              success('Backup created')
              setBackups(await fetchBackups())
            } catch (e: any) {
              failure('Backup failed', e.message)
            }
          }}
        >
          <Archive className="size-3 mr-1" />
          Backup
        </Button>
        <select
          value={restoreName ?? ''}
          onChange={(e) => setRestoreName(e.target.value || null)}
          aria-label="Choose a backup to restore"
          className="h-7 min-w-0 rounded border border-border/50 bg-transparent px-1 text-[12px] text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">Restore backup…</option>
          {backups.map((b) => (
            <option key={b.name} value={b.name}>
              {b.name.slice(0, 25)}
            </option>
          ))}
        </select>
        <Button size="sm" variant="ghost" onClick={() => setConfirmRestore(true)} disabled={!restoreName}>
          <RotateCcw className="size-3 mr-1" />
          Restore
        </Button>
      </div>

      <ConfirmDialog
        open={confirmDeleteSpace !== null}
        onOpenChange={() => setConfirmDeleteSpace(null)}
        title="Delete space?"
        description={
          confirmDeleteSpace === null
            ? ''
            : `“${spaces[confirmDeleteSpace]?.name ?? 'This space'}” and its ${
                spaces[confirmDeleteSpace]?.disks.length ?? 0
              } disk mapping(s) will be removed when you save. The reports on disk are not touched.`
        }
        action="Remove"
        onConfirm={() => {
          if (confirmDeleteSpace !== null) {
            const idx = confirmDeleteSpace
            setSpaces((s) => s.filter((_, i: number) => i !== idx))
            setConfirmDeleteSpace(null)
          }
        }}
      />
      {/* Restoring rewrites the whole admin database, which is a larger action
          than anything else on this panel and previously happened on one click. */}
      <ConfirmDialog
        open={confirmRestore}
        onOpenChange={() => setConfirmRestore(false)}
        title="Restore this backup?"
        description={`Every space, disk mapping, group and account will be replaced by the contents of ${restoreName ?? 'the backup'}. This cannot be undone.`}
        action="Restore"
        onConfirm={async () => {
          setConfirmRestore(false)
          if (!restoreName) return
          try {
            await restoreBackup(restoreName)
            success('Restored')
            setRestoreName(null)
            clearApiCache()
            void load()
          } catch (e: any) {
            failure('Restore failed', e.message)
          }
        }}
      />
    </div>
  )
}

// ── Accounts Content ────────────────────────────────────────────────

function AccountsContent() {
  const [list, setList] = useState<any[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [nu, setNu] = useState('')
  const [np, setNp] = useState('')
  const [resetId, setResetId] = useState<number | null>(null)
  const [resetPw, setResetPw] = useState('')
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [confirmName, setConfirmName] = useState('')
  useEffect(() => {
    fetchAccounts()
      .then(setList)
      .catch(() => {})
  }, [])
  return (
    <div>
      <p className="text-sm font-semibold mb-3">Accounts · {list.length}</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-y border-border text-left text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
            <th className="py-2">Username</th>
            <th className="py-2">Role</th>
            <th className="py-2">Created</th>
            <th className="py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {list.map((a: any) => (
            <tr key={a.id} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
              <td className="py-2">{a.username}</td>
              <td className="py-2">
                <Badge variant={a.role === 'owner' ? 'default' : 'secondary'} className="text-[12px]">
                  {a.role}
                </Badge>
              </td>
              <td className="py-2 text-muted-foreground">{a.created_at.slice(0, 10)}</td>
              <td className="py-2 text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Reset password for ${a.username}`}
                  title={`Reset password for ${a.username}`}
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
                    aria-label={`Delete account ${a.username}`}
                    title={`Delete account ${a.username}`}
                    onClick={() => {
                      setConfirmId(a.id)
                      setConfirmName(a.username)
                    }}
                  >
                    <Trash2 className="size-3 text-destructive" />
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!showCreate ? (
        <Button size="sm" onClick={() => setShowCreate(true)} className="mt-2">
          <Plus className="size-3.5 mr-1" />
          Create Account
        </Button>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            try {
              await createAccount(nu, np, 'admin')
              success('Account created', nu)
              setShowCreate(false)
              setNu('')
              setNp('')
              fetchAccounts().then(setList)
            } catch (e: any) {
              failure('Create failed', e.message)
            }
          }}
          className="flex gap-2 pt-2"
        >
          <Input
            placeholder="Username"
            value={nu}
            onChange={(e) => setNu(e.target.value)}
            className="flex-1"
            autoFocus
          />
          <PwInput placeholder="Password" value={np} onChange={setNp} />
          <Button type="submit" disabled={!nu || np.length < 10}>
            Create
          </Button>
        </form>
      )}
      <Dialog open={resetId !== null} onOpenChange={() => setResetId(null)}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (resetId !== null) {
                resetAccountPassword(resetId, resetPw)
                  .then(() => {
                    success('Password reset')
                    setResetId(null)
                    setResetPw('')
                  })
                  .catch((e) => failure('Reset failed', e.message))
              }
            }}
            className="space-y-3"
          >
            <PwInput placeholder="New password" value={resetPw} onChange={setResetPw} autoFocus />
            <Button type="submit" className="w-full" disabled={resetPw.length < 10}>
              Reset
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmId !== null}
        onOpenChange={() => setConfirmId(null)}
        title="Delete Account"
        description={`Remove '${confirmName}'?`}
        action="Delete"
        onConfirm={async () => {
          if (confirmId !== null) {
            try {
              await deleteAccount(confirmId)
              success('Account deleted')
              fetchAccounts().then(setList)
            } catch (e: any) {
              failure('Delete failed', e.message)
            }
            setConfirmId(null)
          }
        }}
      />
    </div>
  )
}

// ── Backups Content ─────────────────────────────────────────────────

function BackupsContent() {
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [restoreName, setRestoreName] = useState<string | null>(null)
  const [deleteName, setDeleteName] = useState<string | null>(null)
  useEffect(() => {
    fetchBackups()
      .then(setBackups)
      .catch(() => {})
  }, [])
  return (
    <div>
      <p className="text-sm font-semibold mb-3">Backups · {backups.length}</p>
      {backups.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">No backups yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-border text-left text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="py-2">Name</th>
              <th className="py-2">Date</th>
              <th className="py-2">Size</th>
              <th className="py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {backups.map((b) => (
              <tr key={b.name} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                <td className="py-2 font-mono text-[13px]">{b.name}</td>
                <td className="py-2 text-xs text-muted-foreground">{b.mtime.slice(0, 19).replace('T', ' ')}</td>
                <td className="py-2 text-xs text-muted-foreground">{formatBytes(b.size)}</td>
                <td className="py-2 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Restore backup ${b.name}`}
                    title={`Restore backup ${b.name}`}
                    onClick={() => setRestoreName(b.name)}
                  >
                    <RotateCcw className="size-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Delete backup ${b.name}`}
                    title={`Delete backup ${b.name}`}
                    onClick={() => setDeleteName(b.name)}
                  >
                    <Trash2 className="size-3 text-destructive" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Button
        size="sm"
        onClick={async () => {
          try {
            await createBackup()
            success('Backup created')
            fetchBackups().then(setBackups)
          } catch (e: any) {
            failure('Backup failed', e.message)
          }
        }}
        className="mt-3"
      >
        <Archive className="size-3.5 mr-1" />
        Create Backup
      </Button>
      <ConfirmDialog
        open={restoreName !== null}
        onOpenChange={() => setRestoreName(null)}
        title="Restore Backup"
        description="Replace DB?"
        action="Restore"
        onConfirm={async () => {
          if (restoreName) {
            try {
              await restoreBackup(restoreName)
              success('Restored')
              setRestoreName(null)
            } catch (e: any) {
              failure('Restore failed', e.message)
            }
          }
        }}
      />
      <ConfirmDialog
        open={deleteName !== null}
        onOpenChange={() => setDeleteName(null)}
        title="Delete Backup"
        description="Remove?"
        action="Delete"
        onConfirm={async () => {
          if (deleteName) {
            try {
              await deleteBackup(deleteName)
              success('Deleted')
              setDeleteName(null)
              fetchBackups().then(setBackups)
            } catch (e: any) {
              failure('Delete failed', e.message)
            }
          }
        }}
      />
    </div>
  )
}

// ── Group Config Content (three-pane + drag & drop) ─────────────────

function GroupConfigContent() {
  const [allDisks, setAllDisks] = useState<any[]>([])
  const [diskTeams, setDiskTeams] = useState<Record<number, any[]>>({})
  const [allUsers, setAllUsers] = useState<string[]>([])
  const [diskSearch, setDiskSearch] = useState('')
  const [groupSearch, setGroupSearch] = useState('')
  const [userSearch, setUserSearch] = useState('')
  const [selectedDisk, setSelectedDisk] = useState<any>(null)
  const [selectedTeam, setSelectedTeam] = useState<any | 'other' | null>(null)
  const [addingGroup, setAddingGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [userInput, setUserInput] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)
  const [importing, setImporting] = useState(false)
  const [importedDisks, setImportedDisks] = useState<Set<number>>(new Set())
  const [selectedUserNames, setSelectedUserNames] = useState<Set<string>>(new Set())
  // Mutable ref for drag — matches legacy's synchronous state.dragUser
  const dragNames = useRef<string[]>([])
  const [showHelp, setShowHelp] = useState(false)

  const onExportFull = () => {
    const data = allDisks.map((d: any) => ({
      disk: d.name,
      space: d.spaceName,
      teams: (diskTeams[d.id] || []).map((t: any) => ({ name: t.name, users: t.users })),
    }))
    const blob = new Blob(
      [JSON.stringify({ version: 1, exported_at: new Date().toISOString(), disks: data }, null, 2)],
      { type: 'application/json' },
    )
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `group-config-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
  }

  const onImportFile = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const parsed = JSON.parse(text)
        const disks: any[] = parsed.disks || parsed
        if (!Array.isArray(disks)) throw new Error('Invalid format: expected array')
        let imported = 0
        for (const entry of disks) {
          const diskName = entry.disk || entry.name
          if (!diskName) continue
          const disk = allDisks.find((d: any) => d.name === diskName)
          if (!disk) continue
          const teams = entry.teams || []
          if (!Array.isArray(teams)) continue
          for (const team of teams) {
            if (!team.name) continue
            const existing = diskTeams[disk.id] || []
            if (existing.some((t: any) => t.name === team.name)) continue
            await createDiskTeam(disk.id, team.name)
            const users = Array.isArray(team.users) ? team.users : []
            if (users.length > 0) {
              const created = await fetchDiskTeams(disk.id)
              const t = created.find((ct: any) => ct.name === team.name)
              if (t) await updateDiskTeam(t.id, { users })
            }
            imported++
          }
        }
        success(`Imported ${imported} teams`)
        if (selectedDisk)
          fetchDiskTeams(selectedDisk.id).then((t) => setDiskTeams((d) => ({ ...d, [selectedDisk.id]: t })))
        clearApiCache()
      } catch (e: any) {
        failure('Import failed', e.message)
      }
    }
    input.click()
  }
  const [renamingTeam, setRenamingTeam] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')

  useEffect(() => {
    fetchSpaces()
      .then((sp) =>
        setAllDisks(sp.flatMap((s: any) => s.disks.map((d: any) => ({ id: d.id, name: d.name, spaceName: s.name })))),
      )
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedDisk) return
    fetchDiskUsers(selectedDisk.id)
      .then(setAllUsers)
      .catch(() => {})
    fetchDiskTeams(selectedDisk.id)
      .then((teams) => {
        if (teams.length === 0 && !importedDisks.has(selectedDisk.id)) {
          setImportedDisks((s) => new Set(s).add(selectedDisk.id))
          importDiskTeams(selectedDisk.id)
            .then((r) => setDiskTeams((d) => ({ ...d, [selectedDisk.id]: r.teams })))
            .catch(() => {})
        } else setDiskTeams((d) => ({ ...d, [selectedDisk.id]: teams }))
      })
      .catch(() => {})
  }, [selectedDisk])

  const teams: any[] = selectedDisk ? diskTeams[selectedDisk.id] || [] : []
  const filteredTeams = teams.filter(
    (t: any) => !groupSearch || t.name.toLowerCase().includes(groupSearch.toLowerCase()),
  )
  const teamUserSet = new Set<string>(teams.flatMap((t: any) => t.users as string[]))
  const otherUsers = allUsers.filter((u) => !teamUserSet.has(u))
  const filteredOther = otherUsers.filter((u) => !userSearch || u.toLowerCase().includes(userSearch.toLowerCase()))
  const selectedTeamReal =
    selectedTeam === 'other'
      ? null
      : selectedTeam
        ? (teams.find((t: any) => t.id === selectedTeam.id) ?? selectedTeam)
        : null
  const refreshTeams = async () => {
    if (!selectedDisk) return
    const teams = await fetchDiskTeams(selectedDisk.id)
    setDiskTeams((d) => ({ ...d, [selectedDisk.id]: teams }))
    clearApiCache()
  }

  const moveUser = async (names: string[], to: any) => {
    if (!selectedDisk || names.length === 0) return
    const all = [...teams]
    if (to === 'other') {
      for (const t of all) {
        const toRemove = names.filter((n: string) => t.users.includes(n))
        if (toRemove.length > 0)
          await updateDiskTeam(t.id, { users: t.users.filter((u: string) => !names.includes(u)) })
      }
    } else {
      const target = all.find((t: any) => t.id === to)
      if (!target) return
      const newUsers = [...target.users]
      for (const name of names) {
        if (!newUsers.includes(name)) newUsers.push(name)
        for (const t of all) {
          if (t.id !== to && t.users.includes(name))
            await updateDiskTeam(t.id, { users: t.users.filter((u: string) => u !== name) })
        }
      }
      await updateDiskTeam(to, { users: newUsers })
    }
    setSelectedUserNames(new Set())
    await refreshTeams()
  }

  const handleDragStart = (e: React.DragEvent, user: string) => {
    const names = selectedUserNames.has(user) && selectedUserNames.size > 0 ? [...selectedUserNames] : [user]
    dragNames.current = names
    e.dataTransfer.setData('text/plain', user)
    e.dataTransfer.effectAllowed = 'move'
  }

  const parseNames = (_e: React.DragEvent): string[] => {
    return dragNames.current
  }

  const handleUserClick = (e: React.MouseEvent, user: string) => {
    if (e.ctrlKey || e.metaKey) {
      setSelectedUserNames((prev) => {
        const next = new Set(prev)
        if (next.has(user)) next.delete(user)
        else next.add(user)
        return next
      })
    } else if (!selectedUserNames.has(user) || selectedUserNames.size <= 1) {
      setSelectedUserNames(new Set([user]))
    }
    // If clicking a selected user in multi-selection, keep selection for drag
  }

  const startRename = (team: any) => {
    if (team.name === 'Other') return
    setRenamingTeam(team.id)
    setRenameValue(team.name)
  }

  const commitRename = async () => {
    if (renamingTeam === null || !renameValue.trim()) {
      setRenamingTeam(null)
      return
    }
    try {
      await updateDiskTeam(renamingTeam, { name: renameValue.trim() })
      await refreshTeams()
    } catch {
      /* */
    }
    setRenamingTeam(null)
  }

  return (
    <>
      <div className="flex items-center gap-2 mb-2 text-[12px]">
        <span className="text-muted-foreground">schema v1</span>
        <div className="flex-1" />
        <button
          onClick={onExportFull}
          title="Export the whole group configuration as JSON"
          className="inline-flex min-h-6 items-center gap-1 rounded px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <Download className="size-3" />
          Export
        </button>
        <button
          onClick={onImportFile}
          title="Import a group configuration JSON file"
          className="inline-flex min-h-6 items-center gap-1 rounded px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <Upload className="size-3" />
          Import
        </button>
        <button
          onClick={() => setShowHelp(true)}
          aria-label="Group config help"
          title="Group config help"
          className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors font-mono text-[13px]"
        >
          ?
        </button>
      </div>
      {/* Three panes side by side need roughly 600px; below that they stack so
          each keeps a usable width instead of squeezing to a few characters. */}
      <div
        className="grid grid-cols-1 gap-3 flex-1 min-h-0 overflow-auto sm:grid-cols-3 sm:overflow-hidden"
        style={{ height: '100%' }}
      >
        {/* Disks */}
        <div className="flex flex-col min-h-0 sm:border-r border-border/30 sm:pr-2">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Disks</p>
          <input
            placeholder="Search…"
            value={diskSearch}
            onChange={(e) => setDiskSearch(e.target.value)}
            className="mb-2 h-7 rounded border border-border/40 bg-background px-2 text-xs outline-none focus:border-emerald-500/40"
          />
          <div className="flex-1 overflow-auto space-y-0.5">
            {(diskSearch
              ? allDisks.filter(
                  (d: any) =>
                    d.name.toLowerCase().includes(diskSearch.toLowerCase()) ||
                    d.spaceName.toLowerCase().includes(diskSearch.toLowerCase()),
                )
              : allDisks
            ).map((d: any) => (
              <button
                key={d.id}
                onClick={() => {
                  setSelectedDisk(d)
                  setSelectedTeam(null)
                  setGroupSearch('')
                  setUserSearch('')
                }}
                className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${selectedDisk?.id === d.id ? 'bg-emerald-500/10 text-foreground font-medium' : 'hover:bg-muted text-foreground'}`}
              >
                <p className="truncate">{d.name}</p>
                <p className="text-[12px] text-muted-foreground/60 truncate">{d.spaceName}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Groups */}
        <div className="flex flex-col min-h-0 sm:border-r border-border/30 sm:pr-2">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Groups</p>
            <div className="flex gap-1">
              {selectedDisk && (
                <button
                  onClick={async () => {
                    if (!selectedDisk) return
                    setImporting(true)
                    try {
                      const r = await importDiskTeams(selectedDisk.id)
                      success(`Imported ${r.imported} teams`)
                      setDiskTeams((d) => ({ ...d, [selectedDisk.id]: r.teams }))
                    } catch (e: any) {
                      failure('Import failed', e.message)
                    } finally {
                      setImporting(false)
                    }
                  }}
                  disabled={importing}
                  className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                >
                  <Upload className="size-2.5" />
                  {importing ? '…' : 'Import'}
                </button>
              )}
              {!addingGroup ? (
                <button
                  onClick={() => {
                    setAddingGroup(true)
                    setNewGroupName('')
                  }}
                  aria-label="Add group"
                  title="Add group"
                  className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <Plus className="size-3" />
                </button>
              ) : null}
            </div>
          </div>
          {addingGroup && (
            <form
              onSubmit={async (e) => {
                e.preventDefault()
                if (!selectedDisk || !newGroupName.trim()) return
                try {
                  await createDiskTeam(selectedDisk.id, newGroupName.trim())
                  setAddingGroup(false)
                  setNewGroupName('')
                  await refreshTeams()
                } catch (e: any) {
                  failure('Create failed', e.message)
                }
              }}
              className="flex gap-1 mb-2"
            >
              <input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Group name"
                autoFocus
                className="flex-1 h-7 rounded border border-border/40 bg-background px-2 text-xs outline-none focus:border-emerald-500/40"
                onBlur={() =>
                  setTimeout(() => {
                    setAddingGroup(false)
                    setNewGroupName('')
                  }, 200)
                }
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setAddingGroup(false)
                    setNewGroupName('')
                  }
                  if (e.key === 'Enter') e.preventDefault()
                }}
              />
              <button
                type="submit"
                className="size-7 rounded bg-emerald-500 text-white text-xs font-medium hover:bg-emerald-400"
              >
                +
              </button>
            </form>
          )}
          <input
            placeholder="Search…"
            value={groupSearch}
            onChange={(e) => setGroupSearch(e.target.value)}
            className="mb-2 h-7 rounded border border-border/40 bg-background px-2 text-xs outline-none focus:border-emerald-500/40"
          />
          <div className="flex-1 overflow-auto space-y-0.5">
            {!selectedDisk ? (
              <p className="text-[12px] text-muted-foreground text-center py-4">Select a disk</p>
            ) : (
              <>
                {filteredTeams.map((t: any) => (
                  <div
                    key={t.id}
                    className={`rounded text-xs transition-colors ${selectedTeam?.id === t.id ? 'bg-emerald-500/10' : ''}`}
                  >
                    {renamingTeam === t.id ? (
                      <input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        autoFocus
                        className="w-full bg-muted/50 rounded px-2 py-1.5 text-xs outline-none focus:border-emerald-500/40 border border-emerald-500/40"
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename()
                          if (e.key === 'Escape') setRenamingTeam(null)
                        }}
                      />
                    ) : (
                      // The delete control is a sibling, not a child: a <button>
                      // inside a <button> is invalid HTML, and browsers recover
                      // by hoisting it out, which breaks its click target.
                      <div
                        className="flex w-full items-center rounded hover:bg-muted"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={async (e) => {
                          e.preventDefault()
                          const names = parseNames(e)
                          if (names.length > 0) await moveUser(names, t.id)
                        }}
                      >
                        <button
                          onClick={() => setSelectedTeam(t)}
                          onDoubleClick={() => startRename(t)}
                          title={`${t.name} — double-click to rename`}
                          className="flex min-w-0 flex-1 items-center gap-1 rounded px-2 py-1.5 text-left"
                        >
                          <span className="flex-1 truncate font-medium">{t.name}</span>
                          <span className="text-[12px] text-muted-foreground/60">{t.users.length}</span>
                        </button>
                        <button
                          onClick={() => setConfirmDelete(t.id)}
                          aria-label={`Delete group ${t.name}`}
                          title={`Delete group ${t.name}`}
                          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground/40 transition-colors hover:text-destructive"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                <div className={`rounded text-xs transition-colors ${selectedTeam === 'other' ? 'bg-muted/50' : ''}`}>
                  <button
                    onClick={() => setSelectedTeam('other')}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={async (e) => {
                      e.preventDefault()
                      const names = parseNames(e)
                      if (names.length > 0) await moveUser(names, 'other')
                    }}
                    className={`flex w-full items-center gap-1 px-2 py-1.5 text-left rounded ${selectedTeam === 'other' ? 'text-foreground font-medium' : 'text-muted-foreground/70 italic'}`}
                  >
                    <span className="flex-1 truncate">Other (unmapped)</span>
                    <span className="text-[12px]">{otherUsers.length}</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Users */}
        <div className="flex flex-col min-h-0">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Users{' '}
            {selectedTeamReal
              ? `· ${selectedTeamReal.users.length}`
              : selectedTeam === 'other'
                ? `· ${otherUsers.length}`
                : ''}
            {selectedUserNames.size > 0 && (
              <span className="ml-2 text-[var(--amber-400)]">{selectedUserNames.size} selected</span>
            )}
          </p>
          {selectedTeamReal && (
            <form
              onSubmit={async (e) => {
                e.preventDefault()
                if (!selectedTeamReal || !userInput.trim()) return
                const names = userInput
                  .split(/[,;\s]+/)
                  .map((s: string) => s.trim())
                  .filter(Boolean)
                const s = new Set<string>(selectedTeamReal.users as string[])
                names.forEach((n: string) => s.add(n))
                try {
                  await updateDiskTeam(selectedTeamReal.id, { users: [...s] })
                  setUserInput('')
                  await refreshTeams()
                } catch (e: any) {
                  failure('Add failed', e.message)
                }
              }}
              className="flex gap-1 mb-2"
            >
              <input
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                placeholder="Add users (comma separated)"
                autoFocus
                className="flex-1 h-7 rounded border border-border/40 bg-background px-2 text-xs outline-none focus:border-emerald-500/40"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setUserInput('')
                    ;(e.target as HTMLInputElement).blur()
                  }
                }}
              />
              <button
                type="submit"
                className="size-7 rounded bg-emerald-500 text-white text-xs font-medium hover:bg-emerald-400 disabled:opacity-50"
                disabled={!userInput.trim()}
              >
                <Plus className="size-3 mx-auto" />
              </button>
            </form>
          )}
          <input
            placeholder="Search…"
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            className="mb-2 h-7 rounded border border-border/40 bg-background px-2 text-xs outline-none focus:border-emerald-500/40"
          />
          <div className="flex-1 overflow-auto space-y-0.5">
            {!selectedDisk ? (
              <p className="text-[12px] text-muted-foreground text-center py-4">Select a disk first</p>
            ) : !selectedTeam ? (
              <p className="text-[12px] text-muted-foreground text-center py-4">Select a group</p>
            ) : selectedTeam === 'other' ? (
              filteredOther.length === 0 ? (
                <p className="text-[12px] text-muted-foreground text-center py-4">All users assigned</p>
              ) : (
                filteredOther.map((u: string) => {
                  const isSel = selectedUserNames.has(u)
                  return (
                    <div
                      key={u}
                      draggable
                      onDragStart={(e) => handleDragStart(e, u)}
                      onClick={(e) => handleUserClick(e, u)}
                      className={`flex items-center gap-1 px-2 py-1 rounded text-xs cursor-grab active:cursor-grabbing transition-colors ${isSel ? 'bg-amber-400/15 text-foreground font-medium' : 'hover:bg-muted'}`}
                    >
                      <User className={`size-3 shrink-0 ${isSel ? 'text-foreground' : 'text-muted-foreground'}`} />
                      <span className="flex-1 truncate">{u}</span>
                      <span className="text-[10px] text-muted-foreground/30">⋮</span>
                    </div>
                  )
                })
              )
            ) : selectedTeamReal ? (
              (userSearch
                ? selectedTeamReal.users.filter((u: string) => u.toLowerCase().includes(userSearch.toLowerCase()))
                : selectedTeamReal.users
              ).map((u: string) => {
                const isSel = selectedUserNames.has(u)
                return (
                  <div
                    key={u}
                    draggable
                    onDragStart={(e) => handleDragStart(e, u)}
                    onClick={(e) => handleUserClick(e, u)}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-xs cursor-grab active:cursor-grabbing transition-colors group ${isSel ? 'bg-amber-400/15 text-foreground font-medium' : 'hover:bg-muted'}`}
                  >
                    <User className={`size-3 shrink-0 ${isSel ? 'text-foreground' : 'text-muted-foreground'}`} />
                    <span className="flex-1 truncate">{u}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        moveUser([u], 'other')
                      }}
                      aria-label={`Remove ${u} from this group`}
                      title={`Remove ${u} from this group`}
                      className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-all hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                )
              })
            ) : null}
          </div>
        </div>
        <ConfirmDialog
          open={confirmDelete !== null}
          onOpenChange={() => setConfirmDelete(null)}
          title="Delete Group"
          description="Users become unmapped."
          action="Delete"
          onConfirm={async () => {
            if (confirmDelete !== null) {
              try {
                await deleteDiskTeam(confirmDelete)
                setConfirmDelete(null)
                setSelectedTeam(null)
                await refreshTeams()
              } catch (e: any) {
                failure('Delete failed', e.message)
              }
            }
          }}
        />
      </div>
      <HelpModal open={showHelp} onClose={() => setShowHelp(false)} />
    </>
  )
}

// ── Help Modal ─────────────────────────────────────────────────────

function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">Group User Config Help</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-xs">
          <div>
            <strong className="text-sm">How to use</strong>
          </div>
          <div>
            <p className="font-medium text-muted-foreground mb-1">Disks column</p>
            <p>Select a disk to view and edit its group assignments.</p>
          </div>
          <div>
            <p className="font-medium text-muted-foreground mb-1">Groups column</p>
            <p>
              • Click a group to see its users
              <br />• Double-click a group name to rename it
              <br />• Click + to add a new group
              <br />• Drag users here to assign them
            </p>
          </div>
          <div>
            <p className="font-medium text-muted-foreground mb-1">Users column</p>
            <p>
              • Ctrl+click to multi-select users
              <br />• Drag selected users to a group or Other
              <br />• Click the X to remove a user from its group
              <br />• Add new users by typing comma-separated names
            </p>
          </div>
          <div>
            <p className="font-medium text-muted-foreground mb-1">Other (unmapped)</p>
            <p>Users not assigned to any group. Drag them to a group to assign them.</p>
          </div>
          <div>
            <p className="font-medium text-muted-foreground mb-1">Import / Export</p>
            <p>
              Export the full group config as JSON. Import a previously exported file to restore or duplicate a
              configuration.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Change Password Content ─────────────────────────────────────────

function ChangePasswordContent(p: { user: AuthInfo['user'] | null; onClose: () => void }) {
  const [cp, setCp] = useState('')
  const [np, setNp] = useState('')
  const [msg, setMsg] = useState('')
  return (
    <div>
      <p className="text-sm font-semibold mb-3">Change Password</p>
      {p.user && (
        <p className="text-xs text-muted-foreground mb-3">
          {p.user.username} · {p.user.role}
        </p>
      )}
      {msg && (
        <div
          className={`rounded-sm px-3 py-2 text-xs mb-3 ${msg.includes('changed') ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'}`}
        >
          {msg}
        </div>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (np.length < 10) {
            setMsg('Password must be at least 10 characters')
            return
          }
          try {
            await changeOwnPassword(cp, np)
            success('Password changed')
            setMsg('')
            setCp('')
            setNp('')
            p.onClose()
          } catch (e: any) {
            setMsg(e.message)
            failure('Failed', e.message)
          }
        }}
        className="space-y-3 max-w-sm"
      >
        <PwInput placeholder="Current password" value={cp} onChange={setCp} />
        <PwInput placeholder="New password (min 10 chars)" value={np} onChange={setNp} />
        <Button type="submit" className="w-full" disabled={!cp || np.length < 10}>
          Change Password
        </Button>
      </form>
    </div>
  )
}
