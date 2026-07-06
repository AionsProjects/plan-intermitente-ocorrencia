import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "liquid-badge inline-flex w-fit shrink-0 items-center justify-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "[a&]:hover:border-[rgb(var(--accent-rgb)/0.42)]",
        secondary:
          "border-[rgb(var(--ink)/0.12)] text-foreground/72 [a&]:hover:text-foreground",
        destructive:
          "border-rose-300/40 bg-rose-300/15 text-rose-100 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 [a&]:hover:bg-rose-300/20",
        outline:
          "border-[rgb(var(--ink)/0.14)] text-foreground/80 [a&]:hover:text-foreground",
        ghost: "border-transparent bg-transparent shadow-none backdrop-blur-none text-foreground/66 [a&]:hover:text-foreground",
        link: "text-primary underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge }
