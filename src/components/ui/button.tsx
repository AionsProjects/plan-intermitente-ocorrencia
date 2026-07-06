import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "liquid-control inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-2xl text-sm font-medium outline-none disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border-[rgb(var(--accent-rgb)/0.42)] bg-[linear-gradient(135deg,rgb(var(--accent-rgb)/0.92),rgb(var(--accent-rgb)/0.62))] text-[#080b12] shadow-[0_18px_42px_-18px_rgb(var(--accent-rgb)/0.82),inset_0_1px_0_0_rgb(var(--ink)/0.35)] hover:border-[rgb(var(--accent-rgb)/0.64)]",
        destructive:
          "border-rose-300/40 bg-rose-300/15 text-rose-100 hover:border-rose-300/60 hover:bg-rose-300/20",
        outline:
          "text-foreground/86 hover:text-foreground",
        secondary:
          "border-[rgb(var(--ink)/0.12)] text-foreground/84 hover:text-foreground",
        ghost:
          "border-transparent bg-transparent shadow-none backdrop-blur-none text-foreground/70 hover:border-[rgb(var(--ink)/0.16)] hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-xl px-3 has-[>svg]:px-2.5",
        lg: "h-11 rounded-2xl px-6 has-[>svg]:px-4",
        icon: "size-10",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 rounded-xl",
        "icon-lg": "size-11 rounded-2xl",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button }
