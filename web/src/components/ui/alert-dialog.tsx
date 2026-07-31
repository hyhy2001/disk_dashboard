import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils.js'

interface AlertDialogContext {
  open: boolean
  onOpenChange: (v: boolean) => void
}
const Ctx = createContext<AlertDialogContext>({ open: false, onOpenChange: () => {} })

export function AlertDialog({
  open: controlled,
  onOpenChange,
  children,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  children: ReactNode
}) {
  return <Ctx.Provider value={{ open: controlled, onOpenChange }}>{children}</Ctx.Provider>
}

export function AlertDialogTrigger({ asChild, onClick, children, className, ...props }: any) {
  const { onOpenChange } = useContext(Ctx)
  if (asChild) {
    return (
      <span
        onClick={() => {
          onClick?.()
          onOpenChange(true)
        }}
        {...props}
      >
        {children}
      </span>
    )
  }
  return (
    <button
      onClick={() => {
        onClick?.()
        onOpenChange(true)
      }}
      className={className}
      {...props}
    >
      {children}
    </button>
  )
}

export function AlertDialogContent({ children, className }: { children: ReactNode; className?: string }) {
  const { open, onOpenChange } = useContext(Ctx)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', handler)
    ref.current?.focus()
    return () => window.removeEventListener('keydown', handler)
  }, [open, onOpenChange])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={() => onOpenChange(false)}
    >
      <div
        ref={ref}
        tabIndex={-1}
        className={cn(
          'bg-card border border-border rounded-md shadow-lg max-w-md w-full mx-4 animate-slide-up',
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

export function AlertDialogHeader({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('px-5 pt-5 pb-2 space-y-1', className)}>{children}</div>
}

export function AlertDialogTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn('text-sm font-semibold', className)}>{children}</h2>
}

export function AlertDialogDescription({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-xs text-muted-foreground leading-relaxed', className)}>{children}</p>
}

export function AlertDialogFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex justify-end gap-2 px-5 pb-5 pt-3', className)}>{children}</div>
}

export function AlertDialogAction({ onClick, children, className, ...props }: any) {
  const { onOpenChange } = useContext(Ctx)
  return (
    <button
      onClick={() => {
        onClick?.()
        onOpenChange(false)
      }}
      className={cn(
        'inline-flex items-center rounded-sm bg-primary text-primary-foreground px-4 py-1.5 text-xs font-medium hover:opacity-90 transition-colors',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export function AlertDialogCancel({ onClick, children, className, ...props }: any) {
  const { onOpenChange } = useContext(Ctx)
  return (
    <button
      onClick={() => {
        onClick?.()
        onOpenChange(false)
      }}
      className={cn(
        'inline-flex items-center rounded-sm border border-border px-4 py-1.5 text-xs hover:bg-muted transition-colors',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
