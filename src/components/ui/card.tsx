import * as React from "react"

import { cn } from "@/lib/utils"

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        // shadow-xs, not the shadcn default shadow-sm. Every panel AFCT builds by hand (the
        // settings boxes, the status sections, the rail cards, the course banner) already uses
        // xs, so the shared Card was the one content surface floating higher than its
        // neighbours, and it showed most beside a DataTable, whose shell carries no shadow at
        // all. One level for ordinary work surfaces: white fill, a quiet border, and just
        // enough shadow to seat it. Overlays keep theirs; dropdowns, popovers, dialogs and the
        // sign-in card are md or lg and stay that way.
        "bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-xs",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({
  className,
  role = "heading",
  "aria-level": ariaLevel = 3,
  ...props
}: React.ComponentProps<"div">) {
  // Card titles are headings by default so the page keeps a real heading outline
  // for screen readers. Callers can override role/aria-level (many already pass
  // their own level); this changes no rendered pixels.
  return (
    <div
      data-slot="card-title"
      role={role}
      aria-level={role === "heading" ? ariaLevel : undefined}
      className={cn("text-base leading-none font-semibold", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-6", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-6 [.border-t]:pt-6", className)}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
