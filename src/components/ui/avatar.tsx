"use client"

import * as React from "react"
import * as AvatarPrimitive from "@radix-ui/react-avatar"

import { cn } from "@/lib/utils"

function Avatar({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(
        "relative flex size-8 shrink-0 overflow-hidden rounded-full",
        className
      )}
      {...props}
    />
  )
}

interface AvatarImageProps extends React.ComponentProps<typeof AvatarPrimitive.Image> {
  // Framing from the stored avatar (0..1, zoom multiplier). Optional so call sites
  // that don't have crop data render centered/unscaled (the defaults are an identity
  // transform, i.e. the same as no cropping).
  cropX?: number;
  cropY?: number;
  zoom?: number;
}

function AvatarImage({
  className,
  style,
  cropX = 0.5,
  cropY = 0.5,
  zoom = 1,
  ...props
}: AvatarImageProps) {
  const pctX = (0.5 - cropX) * 100;
  const pctY = (0.5 - cropY) * 100;

  const cropStyle: React.CSSProperties = {
    ...style,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    objectPosition: "center",
    transformOrigin: "center",
    transform: `scale(${zoom}) translate(${pctX}%, ${pctY}%)`,
  };

  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      draggable={false}
      onDragStart={(event) => event.preventDefault()}
      className={cn("aspect-square size-full", className)}
      style={cropStyle}
      {...props}
    />
  );
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "bg-muted flex size-full items-center justify-center rounded-full",
        className
      )}
      {...props}
    />
  )
}

export { Avatar, AvatarImage, AvatarFallback }
