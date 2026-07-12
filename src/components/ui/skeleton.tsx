import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      // Placeholder shapes are decorative; hide them from AT (a sibling
      // role="status" should carry the loading announcement). Callers can override.
      aria-hidden="true"
      className={cn("bg-accent animate-pulse rounded-md", className)}
      {...props}
    />
  )
}

export { Skeleton }
