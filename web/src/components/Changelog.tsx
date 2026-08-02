// Change log — versioned notes behind the Settings menu.
//
// Mirrors the legacy app's changelog modal: a running list of what changed, newest
// first. Entries are hand-maintained; keep each release a concise bullet list of
// user-visible changes.

import { Modal } from './Modal.js'

export interface ChangelogEntry {
  version: string
  date: string
  title: string
  bullets: string[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: 'v2.0',
    date: '2026-07-31',
    title: 'Slug-based routes and admin hardening',
    bullets: [
      'Disks are now addressed by a random route slug, so two spaces can hold disks with the same name without URL collisions.',
      'Old /space/<name> links redirect automatically to the new slug URL.',
      'Duplicate disk names within a space are rejected with a clear error instead of a server fault.',
      'Admin Spaces list now shows each disk\u2019s shareable URL, with a copy button.',
      'History tab keeps the user list always visible, no toggle needed.',
    ],
  },
  {
    version: 'v1.0',
    date: '2026-06',
    title: 'Dashboard rewrite',
    bullets: [
      'Reads duscan report.db files directly; the dashboard never starts a scan or writes to a report.',
      'Overview with capacity timeline, team usage, and top users per disk.',
      'Treemap drill-down with file listing and name search.',
      'History with date-range filtering and per-user trends.',
      'User detail, permission issues, and inode usage views.',
      'Space comparison across disks with absolute / log / percent chart modes.',
      'Admin panel with accounts, spaces, disk teams, and backup/restore.',
    ],
  },
]

export function ChangelogModal({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <Modal title="Change log" onClose={onClose} footer={<span>Press Esc to close</span>}>
      <div className="space-y-4">
        {CHANGELOG.map((entry) => (
          <section key={entry.version}>
            <header className="flex items-baseline gap-2 mb-1">
              <h3 className="text-xs font-semibold">{entry.version}</h3>
              <span className="text-[12px] text-muted-foreground">{entry.date}</span>
              <span className="text-[13px] text-muted-foreground flex-1">{entry.title}</span>
            </header>
            <ul className="space-y-1 ml-1">
              {entry.bullets.map((b, i) => (
                <li key={i} className="text-xs text-muted-foreground flex gap-2">
                  <span className="text-emerald-500/70 shrink-0">·</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  )
}
