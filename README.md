# disk_dashboard

Web dashboard for reading duscan `report.db` files.

The scanner (`duscan`) writes reports; this project only reads them. There is no
shared code between the two — `report.db` is self-describing, so the dashboard
depends on the schema, not on the binary.

## Layout

```
shared/       API types used by both sides
server/       Fastify + better-sqlite3, readonly access to report.db
web/          React + TypeScript + Vite
```

## Run

```sh
npm install
npm run dev     # Fastify on :5310, Vite on :5311 (proxies /api)
```

Open http://127.0.0.1:5311.

For a single-process production run:

```sh
npm run build
DASHBOARD_WEB_DIR=web/dist npm start   # serves API + assets on :5310
```

## Deployment

`dashboard.hydev.me` is nginx proxying to `127.0.0.1:5311`. That port is served by
one pm2-managed process which handles both the API and the built assets:

```sh
npm run build
pm2 start ecosystem.config.cjs
pm2 save                              # survive reboot
```

After changing code, `npm run build && pm2 restart disk-dashboard`.

Do not put `npm run dev` behind the vhost. Vite plus `tsx watch` has no restart
policy, so any crash leaves nginx returning 502 with nothing bringing it back.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `DASHBOARD_REPORTS_DIR` | `../disk_scanner/reports` | Directory holding one subdir per target |
| `DASHBOARD_PORT` | `5310` | Listen port |
| `DASHBOARD_HOST` | `127.0.0.1` | Listen address |
| `DASHBOARD_WEB_DIR` | unset | Built assets to serve; unset means API-only |
| `DASHBOARD_LOG_LEVEL` | `info` | Fastify log level |

Targets are auto-discovered: any `<reportsDir>/<name>/report.db` shows up in the
picker. No manual disk map to maintain.

### Grouping targets

The sidebar's two-level Space → Disk navigation comes from an optional
`teams.json` in the reports directory:

```json
[
  { "name": "Production", "targets": ["Test", "ABC"] },
  { "name": "System",     "targets": ["usr"] }
]
```

Re-read whenever the file changes, so no restart is needed. Rules:

- Groups appear in file order; targets keep newest-scan-first order within one.
- A target no group names is appended under **Ungrouped** — never hidden, since a
  target on disk must always be reachable.
- A target listed twice belongs to the first group only.
- A named target that has not been scanned yet is skipped, not an error.
- No file, or an unparseable one, puts everything in one **All Targets** group.
  `/api/health` reports `groupConfigLoaded`, which is the only way to tell a typo
  from an intentional absence.

The `DASHBOARD_REPORTS_DIR` default resolves from the repo root, not the current
directory — `npm run dev` runs workspace scripts with cwd = `server/`, so a
cwd-relative default would point at different places depending on how the server
was started. `/api/health` reports the path it settled on plus whether it exists.

## Security

The server has **no authentication** and exposes filesystem usage and usernames.
It binds `127.0.0.1` by default for that reason — put it behind a reverse proxy
that handles auth before setting `DASHBOARD_HOST` to a public interface.

## Views

| View | Source tables |
|---|---|
| Space comparison (no disk selected) | `hist_snapshots` per target |
| Overview | `hist_*`, `detail_users` |
| TreeMap | `treemap_*` (+ `detail_files` for file lists) |
| History | `hist_snapshots`, `hist_user_usage` |
| Detail User | `detail_dirs`, `detail_files`, `detail_file_names` |
| Permission Issues | `perm_issues` |

**Inodes** has no view: `report.db` carries no inode table, so there is nothing to
read. It needs duscan to emit one first.

**Permission Issues** shows "no permission issues" on most reports, because a scan
run as root is denied nothing. That is the healthy result, not a failure — rows
appear when duscan runs as a user that cannot read everything.

## Routes

The hash carries what you are looking at, so views are linkable and survive a
reload:

```
#/                              first space, comparison view
#/<space>                       one space, comparison view
#/<space>/<disk>/overview       Overview
#/<space>/<disk>/detail/<tab>   treemap | history | detail-user | permissions
```

## Performance

Queries are bounded by design. The Overview and History paths touch only
`detail_users` and `hist_*` — one row per user or per scan. Only Detail User and
TreeMap reach `detail_files` (1.5M rows on a modest target, far more on a real one),
and they ride existing indexes rather than sorting:

```
detail_dirs   ix_detail_dirs_uid_size_dir        (uid, size DESC, id ASC)
detail_files  ix_detail_files_uid_size_dir_name  (uid, size DESC, dir_id ASC, name_id ASC)
```

Both lead with `uid`, so one user's rows are already a contiguous range in display
order. Pagination is keyset, not `OFFSET`, so page 500 costs what page 1 does.
Measured warm on a 1.5M-file report: directories 1.7ms, files 28ms per page.

The exception is the extension filter — `ext` is not in the covering index, so each
candidate needs a row lookup and a rare extension scans a long way before filling a
page (~1s cold). Fixing it would need an index we cannot add to a readonly report.

## Sync

The dashboard cannot start a scan. `/api/status/:target` reports what it observes: a
`stamp` of `report.db`'s mtime and size, the scan timestamp inside the report, and
duscan's stage if a `scan_status.json` sits beside it. The client polls that and
offers a reload when the stamp moves — which is why the pill reads "Up to date"
rather than "Synced".
