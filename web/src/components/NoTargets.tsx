import type { HealthInfo } from '../../../shared/api.js'
import { Shield, HardDrive, Terminal } from 'lucide-react'

interface Props {
  health: HealthInfo | null
  /** What kind of empty state to show. */
  reason: 'no-disks' | 'disk-no-report'
}

export function NoTargets({ health, reason }: Props): JSX.Element {
  if (reason === 'no-disks') {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-4 max-w-md animate-fade-in">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
            <HardDrive className="size-6 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-semibold">No disks configured</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {health?.needsSetup
                ? 'Create the first admin account to get started.'
                : 'Add a space and disk in the Admin panel.'}
            </p>
          </div>
          <div className="flex justify-center gap-2">
            {health?.needsSetup ? (
              <p className="text-xs text-muted-foreground italic">
                Click <Shield className="inline size-3 align-text-bottom" /> <strong>Admin</strong> in the sidebar to create the first account.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground italic">
                Click <Shield className="inline size-3 align-text-bottom" /> <strong>Admin</strong> in the sidebar and add a Space → Disk.
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center h-full p-8">
      <div className="text-center space-y-4 max-w-md animate-fade-in">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
          <Terminal className="size-6 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-semibold">No scan data yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            The disk is configured but no <code className="rounded-sm bg-muted px-1.5 py-0.5 text-[11px]">report.db</code> was found at the configured path.
          </p>
        </div>
        <p className="text-xs text-muted-foreground italic">
          Run <code className="rounded-sm bg-muted px-1.5 py-0.5 text-[11px]">duscan run --target &lt;name&gt;</code> to produce a scan report.
        </p>
      </div>
    </div>
  )
}
