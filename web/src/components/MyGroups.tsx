// The viewer's own grouping, kept in this browser.
//
// Separate from the admin Group Config panel on purpose: this one writes to
// localStorage instead of admin.db and works with no account at all. It is the
// third layer described in lib/groups.ts.
//
// The layout deliberately mirrors the admin panel — Disks | Groups | Users, with
// an "Other (unmapped)" bucket — because it is the same job. A guest picks any
// disk here, not just the one currently open, so the two panels are the same
// shape and the same habits work in both.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { TargetGroup } from '../../../shared/api.js'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Plus, Trash2, Users, X, RotateCcw, User } from 'lucide-react'
import { success } from '@/lib/toast.js'
import { fetchOverview, fetchUsers } from '@/lib/api.js'
import { fingerprintGroups, teamsToGroups, usableGroups, type UserGroup } from '@/lib/groups.js'
import { clearUserGroups, loadUserGroups, saveUserGroups } from '@/lib/prefs.js'

/** One disk as the picker lists it. */
interface DiskChoice {
  slug: string
  name: string
  spaceName: string
}

export function MyGroupsDialog(p: {
  open: boolean
  onClose: () => void
  /** Every space and disk the viewer can see, as the sidebar already knows them. */
  groups: TargetGroup[]
  /** The disk currently open, preselected so the common case needs no clicking. */
  initialSlug: string | null
  onChanged: () => void
}) {
  return !p.open ? null : (
    <Dialog open onOpenChange={p.onClose}>
      <DialogContent className="sm:max-w-[900px] h-[90vh] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-4" />
            Group Config
          </DialogTitle>
        </DialogHeader>
        <MyGroupsContent {...p} />
      </DialogContent>
    </Dialog>
  )
}

function MyGroupsContent(p: { groups: TargetGroup[]; initialSlug: string | null; onChanged: () => void }) {
  const disks = useMemo<DiskChoice[]>(
    () =>
      p.groups.flatMap((space) => space.targets.map((t) => ({ slug: t.slug, name: t.name, spaceName: space.name }))),
    [p.groups],
  )

  const [slug, setSlug] = useState<string | null>(p.initialSlug)
  const [diskSearch, setDiskSearch] = useState('')
  const [groupSearch, setGroupSearch] = useState('')
  const [userSearch, setUserSearch] = useState('')

  /** Every account on the selected disk, and the shared grouping to build from. */
  const [users, setUsers] = useState<string[]>([])
  const [official, setOfficial] = useState<UserGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [groups, setGroups] = useState<UserGroup[]>([])
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  /** Which group's members the Users pane shows: a group name, the leftovers, or nothing. */
  const [selected, setSelected] = useState<string | 'other' | null>(null)
  const [addInput, setAddInput] = useState('')

  // Load the disk's accounts and shared grouping, then seed the editor from
  // whatever the viewer saved — failing that, from the shared grouping, so
  // building on top of it does not mean retyping it.
  //
  // The account list comes from /api/users rather than the overview because the
  // overview caps its user list, which would hide the tail of a large disk from
  // the person doing the grouping.
  useEffect(() => {
    if (!slug) return
    let live = true
    setLoading(true)
    setLoadError(null)
    setSelected(null)
    Promise.all([fetchUsers(slug), fetchOverview(slug)])
      .then(([rows, overview]) => {
        if (!live) return
        const shared = teamsToGroups(overview)
        setUsers(rows.map((r) => r.name))
        setOfficial(shared)
        const saved = loadUserGroups(slug)
        setGroups(saved ? saved.groups : shared.map((g) => ({ name: g.name, users: [...g.users] })))
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!live) return
        setLoadError(err instanceof Error ? err.message : 'Could not read this disk')
        setUsers([])
        setOfficial([])
        setGroups([])
        setLoading(false)
      })
    return () => {
      live = false
    }
  }, [slug])

  const assigned = useMemo(() => {
    const seen = new Set<string>()
    for (const g of groups) for (const u of g.users) seen.add(u.toLowerCase())
    return seen
  }, [groups])

  const unassigned = useMemo(() => users.filter((u) => !assigned.has(u.toLowerCase())), [users, assigned])

  const persist = useCallback(
    (next: UserGroup[]) => {
      setGroups(next)
      if (!slug) return
      const clean = usableGroups(next)
      if (clean.length === 0) {
        // An empty set is the same as having no override; storing it would keep
        // the "on" badge lit for a grouping that changes nothing.
        clearUserGroups(slug)
      } else {
        saveUserGroups(slug, { groups: clean, officialFingerprint: fingerprintGroups(official) })
      }
      p.onChanged()
    },
    [slug, official, p],
  )

  const addGroup = (): void => {
    const name = newName.trim()
    if (!name || groups.some((g) => g.name.toLowerCase() === name.toLowerCase())) return
    persist([...groups, { name, users: [] }])
    setNewName('')
    setAdding(false)
    setSelected(name)
  }

  /** Move users into a group, or out of every group when `to` is the leftovers. */
  const moveUsers = (names: string[], to: string | 'other'): void => {
    if (names.length === 0) return
    const lower = new Set(names.map((n) => n.toLowerCase()))
    const stripped = groups.map((g) => ({ ...g, users: g.users.filter((u) => !lower.has(u.toLowerCase())) }))
    if (to === 'other') {
      persist(stripped)
      return
    }
    persist(stripped.map((g) => (g.name === to ? { ...g, users: [...g.users, ...names] } : g)))
  }

  const resetToOfficial = (): void => {
    if (!slug) return
    clearUserGroups(slug)
    setGroups(official.map((g) => ({ name: g.name, users: [...g.users] })))
    setSelected(null)
    p.onChanged()
    success('Back to the shared groups')
  }

  const shownDisks = diskSearch
    ? disks.filter(
        (d) =>
          d.name.toLowerCase().includes(diskSearch.toLowerCase()) ||
          d.spaceName.toLowerCase().includes(diskSearch.toLowerCase()),
      )
    : disks
  const shownGroups = groupSearch
    ? groups.filter((g) => g.name.toLowerCase().includes(groupSearch.toLowerCase()))
    : groups
  const selectedGroup = selected !== null && selected !== 'other' ? groups.find((g) => g.name === selected) : undefined
  const shownMembers = (() => {
    const list = selected === 'other' ? unassigned : (selectedGroup?.users ?? [])
    return userSearch ? list.filter((u) => u.toLowerCase().includes(userSearch.toLowerCase())) : list
  })()

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <p className="rounded-sm bg-muted px-3 py-2 text-xs text-muted-foreground">
        These groups are saved in this browser only. Nobody else sees them, and they are gone if you clear your browser
        data.
      </p>

      {/* Three panes side by side need roughly 600px; below that they stack so
          each keeps a usable width instead of squeezing to a few characters. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto sm:grid-cols-3 sm:overflow-hidden">
        {/* ── Disks ── */}
        <div className="flex min-h-0 flex-col border-border/30 sm:border-r sm:pr-2">
          <p className="mb-1 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Disks</p>
          <input
            placeholder="Search…"
            value={diskSearch}
            onChange={(e) => setDiskSearch(e.target.value)}
            className="mb-2 h-7 rounded border border-border/40 bg-background px-2 text-xs outline-none focus:border-emerald-500/40"
          />
          <div className="flex-1 space-y-0.5 overflow-auto">
            {shownDisks.length === 0 ? (
              <p className="py-4 text-center text-[12px] text-muted-foreground">No disks</p>
            ) : (
              shownDisks.map((d) => (
                <button
                  key={d.slug}
                  onClick={() => {
                    setSlug(d.slug)
                    setGroupSearch('')
                    setUserSearch('')
                  }}
                  className={`w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
                    slug === d.slug ? 'bg-emerald-500/10 font-medium text-foreground' : 'text-foreground hover:bg-muted'
                  }`}
                >
                  <p className="truncate">{d.name}</p>
                  <p className="truncate text-[12px] text-muted-foreground/60">{d.spaceName}</p>
                </button>
              ))
            )}
          </div>
        </div>

        {/* ── Groups ── */}
        <div className="flex min-h-0 flex-col border-border/30 sm:border-r sm:pr-2">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Groups</p>
            <div className="flex items-center gap-1">
              {slug && (
                <button
                  onClick={resetToOfficial}
                  aria-label="Reset to the shared groups"
                  title="Discard my groups for this disk and use the shared ones"
                  className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <RotateCcw className="size-3" />
                </button>
              )}
              {slug && !adding && (
                <button
                  onClick={() => {
                    setAdding(true)
                    setNewName('')
                  }}
                  aria-label="Add group"
                  title="Add group"
                  className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Plus className="size-3" />
                </button>
              )}
            </div>
          </div>
          {adding && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                addGroup()
              }}
              className="mb-2 flex gap-1"
            >
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Group name"
                autoFocus
                className="h-7 flex-1 rounded border border-border/40 bg-background px-2 text-xs outline-none focus:border-emerald-500/40"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setAdding(false)
                    setNewName('')
                  }
                }}
              />
              <button
                type="submit"
                disabled={!newName.trim()}
                className="size-7 rounded bg-emerald-500 text-xs font-medium text-white hover:bg-emerald-400 disabled:opacity-50"
              >
                <Plus className="mx-auto size-3" />
              </button>
            </form>
          )}
          <input
            placeholder="Search…"
            value={groupSearch}
            onChange={(e) => setGroupSearch(e.target.value)}
            className="mb-2 h-7 rounded border border-border/40 bg-background px-2 text-xs outline-none focus:border-emerald-500/40"
          />
          <div className="flex-1 space-y-0.5 overflow-auto">
            {!slug ? (
              <p className="py-4 text-center text-[12px] text-muted-foreground">Select a disk</p>
            ) : loading ? (
              <p className="py-4 text-center text-[12px] text-muted-foreground">Loading…</p>
            ) : loadError ? (
              <p className="py-4 text-center text-[12px] text-destructive">{loadError}</p>
            ) : (
              <>
                {shownGroups.map((g) => (
                  <div
                    key={g.name}
                    className={`rounded text-xs transition-colors ${selected === g.name ? 'bg-emerald-500/10' : ''}`}
                  >
                    {/* The delete control is a sibling, not a child: a <button>
                        inside a <button> is invalid HTML, and browsers recover by
                        hoisting it out, which breaks its click target. */}
                    <div className="flex w-full items-center rounded hover:bg-muted">
                      <button
                        onClick={() => setSelected(g.name)}
                        title={`Select “${g.name}” to see and change who is in it`}
                        className="flex min-w-0 flex-1 items-center gap-1 rounded px-2 py-1.5 text-left"
                      >
                        <span className="flex-1 truncate font-medium">{g.name}</span>
                        <span className="text-[12px] text-muted-foreground/60">{g.users.length}</span>
                      </button>
                      <button
                        onClick={() => {
                          persist(groups.filter((x) => x.name !== g.name))
                          if (selected === g.name) setSelected(null)
                        }}
                        aria-label={`Delete group ${g.name}`}
                        title={`Delete group ${g.name}`}
                        className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground/40 transition-colors hover:text-destructive"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  </div>
                ))}
                <div className={`rounded text-xs transition-colors ${selected === 'other' ? 'bg-muted/50' : ''}`}>
                  <button
                    onClick={() => setSelected('other')}
                    className={`flex w-full items-center gap-1 rounded px-2 py-1.5 text-left ${
                      selected === 'other' ? 'font-medium text-foreground' : 'italic text-muted-foreground/70'
                    }`}
                  >
                    <span className="flex-1 truncate">Other (unmapped)</span>
                    <span className="text-[12px]">{unassigned.length}</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Users ── */}
        <div className="flex min-h-0 flex-col">
          <p className="mb-1 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
            Users
            {selected === 'other' ? ` · ${unassigned.length}` : selectedGroup ? ` · ${selectedGroup.users.length}` : ''}
          </p>
          {selectedGroup && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const names = addInput
                  .split(/[,;\s]+/)
                  .map((s) => s.trim())
                  .filter(Boolean)
                if (names.length === 0) return
                moveUsers(names, selectedGroup.name)
                setAddInput('')
              }}
              className="mb-2 flex gap-1"
            >
              <input
                value={addInput}
                onChange={(e) => setAddInput(e.target.value)}
                placeholder="Add users (comma separated)"
                className="h-7 flex-1 rounded border border-border/40 bg-background px-2 text-xs outline-none focus:border-emerald-500/40"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setAddInput('')
                }}
              />
              <button
                type="submit"
                disabled={!addInput.trim()}
                className="size-7 rounded bg-emerald-500 text-xs font-medium text-white hover:bg-emerald-400 disabled:opacity-50"
              >
                <Plus className="mx-auto size-3" />
              </button>
            </form>
          )}
          <input
            placeholder="Search…"
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            className="mb-2 h-7 rounded border border-border/40 bg-background px-2 text-xs outline-none focus:border-emerald-500/40"
          />
          <div className="flex-1 space-y-0.5 overflow-auto">
            {!slug ? (
              <p className="py-4 text-center text-[12px] text-muted-foreground">Select a disk first</p>
            ) : selected === null ? (
              <p className="py-4 text-center text-[12px] text-muted-foreground">Select a group</p>
            ) : shownMembers.length === 0 ? (
              <p className="py-4 text-center text-[12px] text-muted-foreground">
                {selected === 'other' ? 'Everyone is grouped' : 'Nobody in this group yet'}
              </p>
            ) : (
              shownMembers.map((u) =>
                selected === 'other' ? (
                  // The leftovers pane is where users are picked up, so each row
                  // adds to the group that was last selected. With none selected
                  // there is nowhere to add to, which is why the group must be
                  // chosen first.
                  <div key={u} className="group flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-muted">
                    <User className="size-3 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">{u}</span>
                    {groups.length > 0 && (
                      <select
                        aria-label={`Add ${u} to a group`}
                        title={`Add ${u} to a group`}
                        value=""
                        onChange={(e) => {
                          if (e.target.value) moveUsers([u], e.target.value)
                        }}
                        className="h-6 max-w-[110px] rounded border border-border/40 bg-background px-1 text-[11px] outline-none focus:border-emerald-500/40"
                      >
                        <option value="">Add to…</option>
                        {groups.map((g) => (
                          <option key={g.name} value={g.name}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                ) : (
                  <div key={u} className="group flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-muted">
                    <User className="size-3 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">{u}</span>
                    <button
                      onClick={() => moveUsers([u], 'other')}
                      aria-label={`Remove ${u} from this group`}
                      title={`Remove ${u} from this group`}
                      className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-all hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ),
              )
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
