// The viewer's own grouping, kept in this browser.
//
// Separate from the admin Group Config panel on purpose: this one writes to
// localStorage instead of admin.db, works with no account at all, and shows only
// the disk currently open. It is the third layer described in lib/groups.ts.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Plus, Trash2, Users, X, RotateCcw } from 'lucide-react'
import { success } from '@/lib/toast.js'
import { fingerprintGroups, usableGroups, type UserGroup } from '@/lib/groups.js'
import { clearUserGroups, loadUserGroups, saveUserGroups } from '@/lib/prefs.js'

/** Rows the editor works from: every known user and where they currently sit. */
export interface GroupSource {
  /** Every username on this disk that the overview knows about. */
  users: string[]
  /** The official grouping, used as the starting point and change baseline. */
  official: UserGroup[]
}

export function MyGroupsDialog(p: {
  open: boolean
  onClose: () => void
  slug: string
  diskName: string
  source: GroupSource
  onChanged: () => void
}) {
  return !p.open ? null : (
    <Dialog open onOpenChange={p.onClose}>
      <DialogContent className="sm:max-w-[720px] h-[80vh] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-4" />
            My groups — {p.diskName}
          </DialogTitle>
        </DialogHeader>
        <MyGroupsContent {...p} />
      </DialogContent>
    </Dialog>
  )
}

function MyGroupsContent(p: { slug: string; source: GroupSource; onClose: () => void; onChanged: () => void }) {
  const [groups, setGroups] = useState<UserGroup[]>([])
  const [newName, setNewName] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const [userSearch, setUserSearch] = useState('')

  // Start from whatever the viewer saved; failing that, from the official
  // grouping, so building on top of it does not mean retyping it.
  useEffect(() => {
    const saved = loadUserGroups(p.slug)
    setGroups(saved ? saved.groups : p.source.official.map((g) => ({ name: g.name, users: [...g.users] })))
  }, [p.slug, p.source.official])

  const assigned = useMemo(() => {
    const seen = new Map<string, string>()
    for (const g of groups) for (const u of g.users) seen.set(u.toLowerCase(), g.name)
    return seen
  }, [groups])

  const unassigned = useMemo(() => {
    const q = userSearch.trim().toLowerCase()
    return p.source.users.filter((u) => !assigned.has(u.toLowerCase()) && (!q || u.toLowerCase().includes(q)))
  }, [p.source.users, assigned, userSearch])

  const persist = useCallback(
    (next: UserGroup[]) => {
      setGroups(next)
      const clean = usableGroups(next)
      if (clean.length === 0) {
        // An empty set is the same as having no override; storing it would keep
        // the "my groups" badge on for a grouping that changes nothing.
        clearUserGroups(p.slug)
      } else {
        saveUserGroups(p.slug, { groups: clean, officialFingerprint: fingerprintGroups(p.source.official) })
      }
      p.onChanged()
    },
    [p],
  )

  const addGroup = () => {
    const name = newName.trim()
    if (!name || groups.some((g) => g.name.toLowerCase() === name.toLowerCase())) return
    persist([...groups, { name, users: [] }])
    setNewName('')
    setSelected(groups.length)
  }

  const assign = (username: string) => {
    if (selected === null) return
    persist(groups.map((g, i) => (i === selected ? { ...g, users: [...g.users, username] } : g)))
  }

  const unassign = (groupIndex: number, username: string) => {
    persist(groups.map((g, i) => (i === groupIndex ? { ...g, users: g.users.filter((u) => u !== username) } : g)))
  }

  const resetToOfficial = () => {
    clearUserGroups(p.slug)
    setGroups(p.source.official.map((g) => ({ name: g.name, users: [...g.users] })))
    p.onChanged()
    success('Back to the shared groups')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <p className="rounded-sm bg-muted px-3 py-2 text-xs text-muted-foreground">
        These groups are saved in this browser only. Nobody else sees them, and they are gone if you clear your browser
        data.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addGroup()
            }
          }}
          placeholder="New group name"
          className="h-8 max-w-[220px] flex-1"
        />
        <Button size="sm" onClick={addGroup} disabled={!newName.trim()}>
          <Plus className="size-3.5 mr-1" />
          Add group
        </Button>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={resetToOfficial} title="Discard my groups and use the shared ones">
          <RotateCcw className="size-3.5 mr-1" />
          Reset to shared
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto sm:grid-cols-2 sm:overflow-hidden">
        <div className="flex min-h-0 flex-col">
          <p className="mb-1 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">My groups</p>
          <div className="flex-1 space-y-1 overflow-auto">
            {groups.length === 0 ? (
              <p className="py-4 text-center text-[12px] text-muted-foreground">No groups yet</p>
            ) : (
              groups.map((g, i) => (
                <div key={`${g.name}-${i}`} className={`rounded ${selected === i ? 'bg-emerald-500/10' : ''}`}>
                  <div className="flex w-full items-center rounded hover:bg-muted">
                    <button
                      onClick={() => setSelected(i)}
                      className="flex min-w-0 flex-1 items-center gap-1 rounded px-2 py-1.5 text-left text-xs"
                      title={`Select “${g.name}” to add users to it`}
                    >
                      <span className="flex-1 truncate font-medium">{g.name}</span>
                      <span className="text-[12px] text-muted-foreground/60">{g.users.length}</span>
                    </button>
                    <button
                      onClick={() => persist(groups.filter((_, n) => n !== i))}
                      aria-label={`Delete group ${g.name}`}
                      title={`Delete group ${g.name}`}
                      className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground/40 transition-colors hover:text-destructive"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                  {selected === i && g.users.length > 0 && (
                    <div className="flex flex-wrap gap-1 px-2 pb-1.5">
                      {g.users.map((u) => (
                        <button
                          key={u}
                          onClick={() => unassign(i, u)}
                          aria-label={`Remove ${u} from ${g.name}`}
                          title={`Remove ${u} from ${g.name}`}
                          className="inline-flex min-h-6 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[12px] hover:text-destructive"
                        >
                          {u}
                          <X className="size-3" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-col sm:border-l border-border/30 sm:pl-3">
          <p className="mb-1 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
            Ungrouped users
          </p>
          <Input
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            placeholder="Search…"
            className="mb-2 h-8"
          />
          <div className="flex-1 space-y-0.5 overflow-auto">
            {selected === null ? (
              <p className="py-4 text-center text-[12px] text-muted-foreground">Pick a group first</p>
            ) : unassigned.length === 0 ? (
              <p className="py-4 text-center text-[12px] text-muted-foreground">Everyone is grouped</p>
            ) : (
              unassigned.map((u) => (
                <button
                  key={u}
                  onClick={() => assign(u)}
                  title={`Add ${u} to “${groups[selected]?.name}”`}
                  className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs hover:bg-muted"
                >
                  <Plus className="size-3 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">{u}</span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
