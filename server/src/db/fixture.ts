// Builds a miniature report.db for tests.
//
// The schema here is copied from duscan's output (verified against a real
// report.db), so the tests exercise the same column names and types the
// production queries rely on. Using a fixture rather than a scanned report keeps
// the suite runnable on a machine with no scans, and lets tests assert exact
// numbers instead of whatever happens to be on disk.

import Database from 'better-sqlite3'

export interface FixtureOptions {
  /** Omit hist_* rows to simulate a report with no history yet. */
  withHistory?: boolean
  /** Number of extra small children under the root, for truncation tests. */
  extraChildren?: number
}

/**
 * Tree built by default:
 *
 *   /            id 0   1000 bytes total, 2 files directly inside
 *   ├── var      id 1    600     owner root
 *   │   └── log  id 3    400     owner syslog
 *   └── home     id 2    300     owner alice   (leaf, has files)
 *   remainder at root: 100
 */
export function createFixture(opts: FixtureOptions = {}): Database.Database {
  const { withHistory = true, extraChildren = 0 } = opts
  const db = new Database(':memory:')

  db.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

    CREATE TABLE detail_users (
      uid INTEGER PRIMARY KEY, username TEXT NOT NULL, team_id TEXT,
      total_files INTEGER NOT NULL, total_dirs INTEGER NOT NULL,
      total_size INTEGER NOT NULL, permission_issues INTEGER NOT NULL DEFAULT 0,
      is_target INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE hist_snapshots (
      id INTEGER PRIMARY KEY, scan_date INTEGER NOT NULL UNIQUE,
      scanned_at INTEGER, path TEXT, total INTEGER, used INTEGER, available INTEGER
    );
    CREATE TABLE hist_team_usage (
      snapshot_id INTEGER NOT NULL, name TEXT, team_id INTEGER, size INTEGER
    );
    CREATE TABLE hist_user_usage (
      snapshot_id INTEGER NOT NULL, name TEXT, team_id INTEGER, size INTEGER, kind TEXT
    );

    CREATE TABLE treemap_names (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE treemap_owners (uid INTEGER PRIMARY KEY, username TEXT NOT NULL);
    CREATE TABLE treemap_dirs (
      id INTEGER PRIMARY KEY, parent_id INTEGER, name_id INTEGER NOT NULL,
      total_size INTEGER NOT NULL, file_count INTEGER NOT NULL,
      dir_count INTEGER NOT NULL, owner_uid INTEGER NOT NULL,
      has_files INTEGER NOT NULL
    );
    CREATE INDEX ix_treemap_dirs_parent_size ON treemap_dirs(parent_id, total_size DESC);
  `)

  db.exec(`
    INSERT INTO meta (key, value) VALUES
      ('scan_root', '/'), ('scan_timestamp', '1700000000'),
      ('total_files', '42'), ('total_dirs', '4'), ('total_size', '1000');

    INSERT INTO treemap_owners (uid, username) VALUES (0, 'root'), (104, 'syslog');

    INSERT INTO treemap_names (id, name) VALUES
      (0, '/'), (1, 'var'), (2, 'home'), (3, 'log');

    -- id, parent, name, size, files, dirs, owner, has_files
    INSERT INTO treemap_dirs VALUES
      (0, NULL, 0, 1000, 2, 2, 0,   1),
      (1, 0,    1,  600, 0, 1, 0,   0),
      (2, 0,    2,  300, 5, 0, 900, 1),
      (3, 1,    3,  400, 3, 0, 104, 1);

    INSERT INTO detail_users (uid, username, team_id, total_files, total_dirs, total_size) VALUES
      (0,   'root',  '1',  20, 2, 700),
      (900, 'alice', '1',   5, 0, 200),
      (104, 'syslog', NULL, 3, 0,  80),
      (105, 'nobody', '',   1, 0,  20),
      (106, 'empty',  NULL, 0, 0,   0);
  `)

  // Extra children are all smaller than the named ones, so they land in the
  // truncated tail when the child limit is exceeded.
  if (extraChildren > 0) {
    const name = db.prepare('INSERT INTO treemap_names (id, name) VALUES (?, ?)')
    const dir = db.prepare('INSERT INTO treemap_dirs VALUES (?, 0, ?, ?, 0, 0, 0, 0)')
    for (let i = 0; i < extraChildren; i += 1) {
      const id = 100 + i
      name.run(id, `extra${i}`)
      dir.run(id, id, 1)
    }
  }

  if (withHistory) {
    db.exec(`
      INSERT INTO hist_snapshots (id, scan_date, scanned_at, path, total, used, available) VALUES
        (1, 20240101, 1704067200, '/', 10000, 6000, 4000),
        (2, 20240102, 1704153600, '/', 10000, 6500, 3500);

      INSERT INTO hist_team_usage (snapshot_id, name, team_id, size) VALUES
        (1, 'ALPHA', 1, 5000),
        (2, 'ALPHA', 1, 5400),
        (2, 'BETA',  2, 1100),
        (2, 'GAMMA', 3, 0);

      INSERT INTO hist_user_usage (snapshot_id, name, team_id, size, kind) VALUES
        (2, 'root', 1, 700, 'user'),
        (2, 'syslog', NULL, 80, 'other');
    `)
  }

  return db
}
