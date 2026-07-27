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

## Security

The server has **no authentication** and exposes filesystem usage and usernames.
It binds `127.0.0.1` by default for that reason — put it behind a reverse proxy
that handles auth before setting `DASHBOARD_HOST` to a public interface.

## Status

Overview tab only. History, user detail, treemap, permissions and inodes are
stubbed as disabled tabs.

Queries are deliberately bounded to `detail_users` and `hist_*` (one row per user
or per scan). Nothing in the Overview path scans `detail_files`, which reaches
70M+ rows on production targets.
