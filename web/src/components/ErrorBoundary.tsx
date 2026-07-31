import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ShieldAlert, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
  name?: string
}
interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`ErrorBoundary${this.props.name ? ` (${this.props.name})` : ''}:`, error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children

    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
          <ShieldAlert className="size-6 text-destructive" />
        </div>
        <div className="text-center space-y-1 max-w-md">
          <p className="text-sm font-semibold text-destructive">Something went wrong</p>
          <p className="text-xs text-muted-foreground font-mono break-all">{this.state.error.message}</p>
          {this.props.name && <p className="text-[10px] text-muted-foreground">in {this.props.name}</p>}
        </div>
        <button
          onClick={() => this.setState({ error: null })}
          className="inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 transition-colors"
        >
          <RefreshCw className="size-3" /> Try again
        </button>
      </div>
    )
  }
}
