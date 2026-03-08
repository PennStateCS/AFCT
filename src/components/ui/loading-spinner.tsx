import React from 'react';

type Props = {
  label?: string;
  fullScreen?: boolean;
  className?: string;
};

export default function LoadingSpinner({
  label = 'Loading',
  fullScreen = true,
  className = '',
}: Props) {
  const heightClass = fullScreen ? 'min-h-screen' : 'min-h-[50vh]';

  return (
    <div className={`flex ${heightClass} flex-col items-center justify-center gap-3 ${className}`}>
      <div className="border-muted-foreground/30 border-t-primary h-10 w-10 animate-spin rounded-full border-[5px]" />
      <div className="text-muted-foreground text-sm">{label}</div>
    </div>
  );
}
