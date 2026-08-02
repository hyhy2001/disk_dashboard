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
  /**
   * Give hist_snapshots the inode columns duscan added after the table shipped.
   * Off by default so the common fixture keeps reproducing the older schema,
   * which is what reports written before that change still look like.
   */
  withInodes?: boolean
  /**
   * Build the FTS5 trigram search indexes a modern duscan adds. Off by default
   * so tests exercise the plain-LIKE fallback used by reports from older
   * scanners; the search tests turn it on to pin the FTS path.
   */
  withFts?: boolean
}

/**
 * Tree built by default:
 *
 *   /            id 0   1000 bytes total, 2 files directly inside (60 + 40)
 *   ├── var      id 1    600     owner root,   no files of its own
 *   │   └── log  id 3    400     owner syslog, 1 file
 *   └── home     id 2    300     owner alice,  3 files (leaf)
 *
 * Root's remainder is 100 = 1000 - (600 + 300), which equals its own file bytes.
 * home's owner uid 900 is absent from treemap_owners, covering the uid-N
 * fallback; var has has_files = 0, covering the skip-the-file-query path.
 */
export function createFixture(opts: FixtureOptions = {}): Database.Database {
  const { withHistory = true, extraChildren = 0, withInodes = false, withFts = false } = opts
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

    CREATE TABLE detail_file_names (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE detail_files (
      dir_id INTEGER NOT NULL, name_id INTEGER NOT NULL, ext TEXT NOT NULL,
      uid INTEGER NOT NULL, size INTEGER NOT NULL
    );
    CREATE INDEX ix_detail_files_uid_size_dir_name
      ON detail_files(uid, size DESC, dir_id ASC, name_id ASC);
    -- Serve the name search's join from an FTS hit back to the file rows (see
    -- the scanner's MERGED_INDEX_DDL); ix_treemap_dirs_name_id sits with the
    -- treemap table below.
    CREATE INDEX ix_detail_files_name_id
      ON detail_files(name_id, size DESC, dir_id ASC);

    -- detail_dirs is keyed (id, uid): the same directory appears once per user who
    -- owns bytes in it, which is why the Detail User queries can scan one user's
    -- slice without touching anyone else's rows.
    CREATE TABLE detail_dirs (
      id INTEGER NOT NULL, uid INTEGER NOT NULL, parent_id INTEGER,
      path TEXT NOT NULL, owner_uid INTEGER NOT NULL,
      size INTEGER NOT NULL, files INTEGER NOT NULL,
      PRIMARY KEY (id, uid)
    );
    CREATE INDEX ix_detail_dirs_uid_size_dir ON detail_dirs(uid, size DESC, id ASC);

    CREATE TABLE perm_issues (
      id INTEGER PRIMARY KEY, user TEXT NOT NULL, item_type TEXT NOT NULL,
      error TEXT NOT NULL, path TEXT NOT NULL
    );
    CREATE INDEX ix_perm_user ON perm_issues(user);
    CREATE INDEX ix_perm_user_type ON perm_issues(user, item_type);

    CREATE TABLE treemap_names (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE treemap_owners (uid INTEGER PRIMARY KEY, username TEXT NOT NULL);
    CREATE TABLE treemap_dirs (
      id INTEGER PRIMARY KEY, parent_id INTEGER, name_id INTEGER NOT NULL,
      total_size INTEGER NOT NULL, file_count INTEGER NOT NULL,
      dir_count INTEGER NOT NULL, owner_uid INTEGER NOT NULL,
      has_files INTEGER NOT NULL
    );
    CREATE INDEX ix_treemap_dirs_parent_size ON treemap_dirs(parent_id, total_size DESC);
    CREATE INDEX ix_treemap_dirs_name_id ON treemap_dirs(name_id, total_size DESC);
  `)

  db.exec(`
    INSERT INTO meta (key, value) VALUES
      ('scan_root', '/'), ('scan_timestamp', '1700000000'),
      ('total_files', '42'), ('total_dirs', '4'), ('total_size', '1000');

    INSERT INTO treemap_owners (uid, username) VALUES (0, 'root'), (104, 'syslog');

    INSERT INTO treemap_names (id, name) VALUES
      (0, '/'), (1, 'var'), (2, 'home'), (3, 'log');

    -- id, parent, name, size, files, dirs, owner, has_files
    -- file counts match the detail_files rows inserted below.
    INSERT INTO treemap_dirs VALUES
      (0, NULL, 0, 1000, 2, 2, 0,   1),
      (1, 0,    1,  600, 0, 1, 0,   0),
      (2, 0,    2,  300, 3, 0, 900, 1),
      (3, 1,    3,  400, 1, 0, 104, 1);

    INSERT INTO detail_users (uid, username, team_id, total_files, total_dirs, total_size) VALUES
      (0,   'root',  '1',  20, 2, 700),
      (900, 'alice', '1',   6, 0, 204),
      (104, 'syslog', NULL, 3, 0,  80),
      (105, 'nobody', '',   1, 0,  20),
      (106, 'empty',  NULL, 0, 0,   0);

    INSERT INTO detail_file_names (id, name) VALUES
      (1, 'big.log'), (2, 'small.txt'), (3, 'mid.bin'),
      (4, 'a.dat'), (5, 'b.dat');

    -- Files in / (id 0, has_files=1): sizes 60 + 40 = 100, matching root's
    -- remainder. Files in home (id 2) are owned by an uid absent from
    -- treemap_owners so the uid-N fallback is covered.
    INSERT INTO detail_files (dir_id, name_id, ext, uid, size) VALUES
      (0, 1, 'log', 0,   60),
      (0, 2, 'txt', 0,   40),
      (2, 3, 'bin', 900, 150),
      (2, 4, 'dat', 900, 100),
      (2, 5, 'dat', 900,  50),
      (3, 1, 'log', 104, 400),
      -- A file alice owns inside a directory root owns (/etc, id 6). This models
      -- the real-world case where a user touches a shared directory: the dir has
      -- a per-user row (uid 900) but is owned by root, so it must not appear on
      -- alice's "own directories" list.
      (6, 3, 'cnf', 900, 4);

    -- Paths mirror the treemap tree. alice (900) owns two directories with equal
    -- sizes so the keyset tie-break on id is exercised; root (0) owns the tail.
    -- id, uid, parent, path, owner, size, files
    INSERT INTO detail_dirs VALUES
      (2, 900, 0, '/home',       900, 300, 3),
      (4, 900, 2, '/home/alice', 900, 100, 1),
      (5, 900, 2, '/home/bob',   900, 100, 1),
      (0, 0,   NULL, '/',          0, 700, 2),
      (3, 104, 1, '/var/log',    104, 400, 1),
      (6, 0,   0, '/etc',          0,   4, 1),
      (6, 900, 0, '/etc',          0,   4, 1);

    INSERT INTO perm_issues (id, user, item_type, error, path) VALUES
      (1, 'root',   'directory', 'Permission denied', '/proc/1/fd'),
      (2, 'root',   'file',      'Permission denied', '/proc/1/mem'),
      (3, 'alice',  'directory', 'Permission denied', '/home/alice/.ssh'),
      (4, '',       'file',      'Stale file handle', '/mnt/nfs/gone');
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

  // Mirrors duscan's own ALTER TABLE migration: the columns are added to the
  // table that already exists, so tests see the same shape a widened report has.
  if (withInodes) {
    db.exec(`
      ALTER TABLE hist_snapshots ADD COLUMN inodes_total INTEGER;
      ALTER TABLE hist_snapshots ADD COLUMN inodes_used INTEGER;
      ALTER TABLE hist_snapshots ADD COLUMN inodes_free INTEGER;
      ALTER TABLE hist_snapshots ADD COLUMN inodes_scanned INTEGER;
    `)
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

    // Only the newest snapshot carries inode figures. The older one stays NULL,
    // which is what a widened report looks like: the migration adds the columns
    // but cannot invent figures for scans that ran before it.
    if (withInodes) {
      db.exec(`
        UPDATE hist_snapshots
           SET inodes_total = 8000, inodes_used = 3000,
               inodes_free = 5000, inodes_scanned = 31
         WHERE scan_date = 20240102;
      `)
    }
  }

  // Mirrors the scanner's MERGED_FTS_DDL: external-content trigram tables over
  // the interning tables. Built after all rows are in, exactly as the scanner
  // does.
  if (withFts) {
    db.exec(`
      CREATE VIRTUAL TABLE fts_file_names USING fts5(
        name,
        content='detail_file_names',
        content_rowid='id',
        tokenize='trigram'
      );
      CREATE VIRTUAL TABLE fts_dir_names USING fts5(
        name,
        content='treemap_names',
        content_rowid='id',
        tokenize='trigram'
      );
      INSERT INTO fts_file_names(fts_file_names) VALUES('rebuild');
      INSERT INTO fts_dir_names(fts_dir_names) VALUES('rebuild');
    `)
  }

  return db
}
