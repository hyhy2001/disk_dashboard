// Shown when the API returns zero targets.
//
// An empty target list has two very different causes — a wrong reports path or a
// correct path with no scans yet — and they look identical from the UI. Health
// tells them apart, so this panel names the actual directory being read instead
// of leaving the user to guess.

import type { HealthInfo } from '../../../shared/api.js'

interface Props {
  health: HealthInfo | null
}

export function NoTargets({ health }: Props): JSX.Element {
  if (health && !health.reportsDirExists) {
    return (
      <div className="state state--error">
        <p className="state__title">Reports directory not found</p>
        <p>
          The server is reading <code className="state__path">{health.reportsDir}</code>, which does
          not exist.
        </p>
        <p className="state__hint">
          Point <code>DASHBOARD_REPORTS_DIR</code> at the directory that holds{' '}
          <code>&lt;target&gt;/report.db</code>, then restart the server.
        </p>
      </div>
    )
  }

  return (
    <div className="state">
      <p className="state__title">No scans yet</p>
      <p>
        {health ? (
          <>
            No <code>report.db</code> under <code className="state__path">{health.reportsDir}</code>.
          </>
        ) : (
          <>No report.db found.</>
        )}
      </p>
      <p className="state__hint">Run duscan to produce a report, then reload this page.</p>
    </div>
  )
}
