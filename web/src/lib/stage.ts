// Scan stage vocabulary — the single place the dashboard translates duscan's
// internal phase names into something a user can read.
//
// The stages come from `set_phase()` in `disk_scanner/cli/src/main.rs` plus the
// `"cancelled"` written on SIGINT. They are duscan's own identifiers, not an API
// we control, so anything unknown is passed through verbatim rather than hidden:
// a raw label is ugly, but a blank pill during a real scan is worse.
//
// This map used to be duplicated in DiskColumn and SyncPill, and both copies had
// drifted to the *legacy Python* vocabulary (scan/report/detail/sync) — four
// labels for stages duscan never emits, while every stage it does emit except
// treemap/done/error fell through as a raw identifier.

/** Human-readable label per duscan stage, in roughly the order they occur. */
const STAGE_LABEL: Record<string, string> = {
  queued: 'Queued',
  scanning: 'Scanning files',
  building: 'Building report',
  treemap: 'Building treemap',
  merging: 'Merging report',
  history: 'Writing history',
  syncing: 'Writing report',
  done: 'Completed',
  error: 'Scan failed',
  cancelled: 'Scan cancelled',
}

/** Stages that mean the scan produced no usable result. */
const FAILED_STAGES = new Set(['error', 'cancelled'])

/** Label for a stage, falling back to the raw identifier duscan wrote. */
export function stageLabel(stage: string | undefined): string | undefined {
  if (stage === undefined) return undefined
  return STAGE_LABEL[stage] ?? stage
}

/**
 * Whether a stage means the scan did not complete. A cancelled scan counts: it
 * leaves the previous report in place, so treating it as success would show a
 * green dot over stale data.
 */
export function isFailedStage(stage: string | undefined): boolean {
  return stage !== undefined && FAILED_STAGES.has(stage)
}
