import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cn } from '@/lib/utils.js'
import { useFocusTrap } from '@/lib/useFocusTrap.js'

interface AlertDialogContext {
  open: boolean
  onOpenChange: (v: boolean) => void
  titleId: string
  descriptionId: string
}
const Ctx = createContext<AlertDialogContext>({ open: false, onOpenChange: () => {}, titleId: '', descriptionId: '' })

export function AlertDialog({
  open: controlled,
  onOpenChange,
  children,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  children: ReactNode
}) {
  const titleId = useId()
  const descriptionId = useId()
  return <Ctx.Provider value={{ open: controlled, onOpenChange, titleId, descriptionId }}>{children}</Ctx.Provider>
}

export function AlertDialogTrigger({ asChild, onClick, children, className, ...props }: any) {
  const { onOpenChange } = useContext(Ctx)
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      onClick={() => {
        onClick?.()
        onOpenChange(true)
      }}
      className={asChild ? undefined : className}
      {...props}
    >
      {children}
    </Comp>
  )
}

export function AlertDialogContent({ children, className }: { children: ReactNode; className?: string }) {
  const { open, onOpenChange, titleId, descriptionId } = useContext(Ctx)
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', handler)

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.focus()

    return () => {
      window.removeEventListener('keydown', handler)
      document.body.style.overflow = prevOverflow
    }
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
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
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
  const { titleId } = useContext(Ctx)
  return (
    <h2 id={titleId} className={cn('text-sm font-semibold', className)}>
      {children}
    </h2>
  )
}

export function AlertDialogDescription({ children, className }: { children: ReactNode; className?: string }) {
  const { descriptionId } = useContext(Ctx)
  return (
    <p id={descriptionId} className={cn('text-xs text-muted-foreground leading-relaxed', className)}>
      {children}
    </p>
  )
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
