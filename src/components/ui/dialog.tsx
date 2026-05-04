import * as React from "react"
import { XIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

/**
 * Overlay "transparente" — só captura clique-fora pra fechar o modal.
 * O efeito visual (escurecer + blur) vem das 4 peças renderizadas no
 * DialogContent, que recortam a região do modal.
 */
const DialogOverlay = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof DialogPrimitive.Overlay>
>(function DialogOverlay({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  )
})

/**
 * Renderiza 4 retângulos com blur ao redor do modal, deixando a área do
 * modal intocada (sem overlay = sem blur). Posições são CSS vars que
 * vêm do DialogContent via ref.
 */
function BlurPieces({
  containerRef,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>
}) {
  return (
    <div
      ref={containerRef}
      aria-hidden
      data-slot="dialog-blur-pieces"
      className="pointer-events-none fixed inset-0 z-40"
      style={
        {
          "--hole-x": "50vw",
          "--hole-y": "50vh",
          "--hole-w": "0px",
          "--hole-h": "0px",
        } as React.CSSProperties
      }
    >
      <div className="dlg-blur-piece dlg-blur-piece--top" />
      <div className="dlg-blur-piece dlg-blur-piece--bottom" />
      <div className="dlg-blur-piece dlg-blur-piece--left" />
      <div className="dlg-blur-piece dlg-blur-piece--right" />
    </div>
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  const piecesRef = React.useRef<HTMLDivElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)

  // Mede o modal e atualiza CSS vars no container das 4 peças blur.
  React.useLayoutEffect(() => {
    const pieces = piecesRef.current
    const content = contentRef.current
    if (!pieces || !content) return

    let raf = 0
    const update = () => {
      raf = 0
      const r = content.getBoundingClientRect()
      const pad = 8 // halo sem blur ao redor do modal
      pieces.style.setProperty("--hole-x", `${r.left - pad}px`)
      pieces.style.setProperty("--hole-y", `${r.top - pad}px`)
      pieces.style.setProperty("--hole-w", `${r.width + pad * 2}px`)
      pieces.style.setProperty("--hole-h", `${r.height + pad * 2}px`)
    }
    const schedule = () => {
      if (raf) return
      raf = requestAnimationFrame(update)
    }

    update()
    const ro = new ResizeObserver(schedule)
    ro.observe(content)
    window.addEventListener("resize", schedule)
    window.addEventListener("scroll", schedule, true)
    return () => {
      ro.disconnect()
      window.removeEventListener("resize", schedule)
      window.removeEventListener("scroll", schedule, true)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <BlurPieces containerRef={piecesRef} />
      <DialogPrimitive.Content
        ref={contentRef}
        data-slot="dialog-content"
        className={cn(
          "fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border bg-background p-6 shadow-lg duration-200 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:max-w-lg",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
