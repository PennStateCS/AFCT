"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

function Table({
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
  ...props
}: React.ComponentProps<"table">) {
  // When the table has an accessible name, make its horizontal-scroll container a
  // focusable, labelled region so keyboard-only users can scroll a wide table
  // (WCAG 2.1.1). The inset focus ring stays visible even when a parent clips
  // overflow (e.g. the DataTable's rounded border). Unlabelled tables keep the
  // plain container — no stray tab stop or unnamed landmark.
  const hasName = Boolean(ariaLabel || ariaLabelledby)

  return (
    <div
      data-slot="table-container"
      className={cn(
        "relative w-full overflow-x-auto",
        hasName &&
          "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-none",
      )}
      {...(hasName
        ? {
            role: "region",
            tabIndex: 0,
            "aria-label": ariaLabel,
            "aria-labelledby": ariaLabelledby,
          }
        : {})}
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "bg-muted border-t font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "hover:bg-muted data-[state=selected]:bg-muted border-b transition-colors",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, scope = "col", ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      scope={scope}
      className={cn(
        "text-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

// Cells wrap by default so long values (emails, titles, evaluator feedback) reflow
// instead of forcing the whole table into a horizontal scroll. Pass `nowrap` for
// values that must stay on one line (dates, counts, short codes). A `whitespace-*`
// class in `className` still wins over both, via tailwind-merge.
// `as="th"` (with a `scope`) renders a row/column header that still looks like a body
// cell: used for a matrix's identity column so screen readers associate each data cell
// with its row header. Defaults to a plain <td>, so existing callers are unaffected.
function TableCell({
  className,
  nowrap = false,
  as: Tag = "td",
  scope,
  ...props
}: React.ComponentProps<"td"> & {
  nowrap?: boolean
  as?: "td" | "th"
  scope?: "row" | "col"
}) {
  return (
    <Tag
      data-slot="table-cell"
      scope={Tag === "th" ? scope : undefined}
      className={cn(
        "p-2 text-left align-middle font-normal [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        nowrap && "whitespace-nowrap",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("text-muted-foreground mt-4 text-sm", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
