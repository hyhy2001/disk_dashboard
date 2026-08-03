# disk-dashboard — web dashboard for duscan report.db files

Serves the reports `duscan` (the Rust scanner in `../disk_scanner`) writes:
one SQLite `report.db` per target, read readonly. `server/` is the Fastify API
(the only thing that reads reports), `web/` the Vite+React UI, `shared/` the
type contract between them. Admin config (accounts, spaces, disks, teams) lives
in `server/admin.db`, not in the reports.

## Commands

```bash
make build        # typecheck + build server & web (production)
make start        # start under the repo-local PM2 (PM2_HOME=.tooling/pm2)
make restart      # delete + start (picks up .env changes)
make stop         # graceful stop, then force-kills any survivor on the port
make status       # pm2 status
make test         # vitest run
make lint         # eslint
make typecheck    # tsc --noEmit for server & web
make dev          # Vite + tsx watch (foreground)
```

Always run `make test` + `make typecheck` + `make lint` after changing code.

## Change Log (always update on user-facing changes)

The UI ships a live Change Log (Settings → Change Log, `ChangeLogModal` in
`web/src/App.tsx`). **Every user-facing change must add an entry there** — a
feature, a fixed bug a user would notice, or a UX change. Internal refactors,
dead-code removal, and test-only work do not need an entry.

Update the `CHANGES` array at the bottom of `web/src/App.tsx`:

- Newest entry first. If today's date already exists, append to its `items`
  instead of creating a second entry for the same day.
- Date format `YYYY-MM-DD`, the same as the working day, not the commit date.
- Write each item as a short, user-facing sentence: what changed and why it
  matters, not how it was implemented. Bundle closely-related fixes into one
  bullet (see existing entries for tone).
- Only describe changes actually made in code — do not preemptively write
  future entries.

## Conventions

- Keep the `{status, data}` API envelope: every handler returns
  `ok(data)` / `fail(reply, code, message)`.
- Report DBs are opened readonly and cached per target by mtime+size — a rescan
  is picked up without a restart.
- Client/server share types via `shared/api.ts`; change it first when an API
  shape changes.
- Commit style: `type: short summary` (fix/feat/chore/style/refactor), one
  logical change per commit.
