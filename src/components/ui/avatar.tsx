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
        // A thin light-gray ring frames every profile photo consistently across the app.
        "relative flex size-8 shrink-0 overflow-hidden rounded-full border border-gray-300",
        className
      )}
      {...props}
    />
  )
}

// The single source of truth for how stored framing (cropX/cropY in 0..1, zoom
// multiplier) maps to a CSS transform. Both the display <AvatarImage> and the crop
// editor consume this, so the editor is pixel-for-pixel what every avatar shows.
function avatarCropStyle(
  cropX = 0.5,
  cropY = 0.5,
  zoom = 1,
  style?: React.CSSProperties
): React.CSSProperties {
  return {
    ...style,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    objectPosition: "center",
    transformOrigin: "center",
    transform: `scale(${zoom}) translate(${(0.5 - cropX) * 100}%, ${(0.5 - cropY) * 100}%)`,
  };
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
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      draggable={false}
      onDragStart={(event) => event.preventDefault()}
      className={cn("aspect-square size-full", className)}
      style={avatarCropStyle(cropX, cropY, zoom, style)}
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

export { Avatar, AvatarImage, AvatarFallback, avatarCropStyle }
