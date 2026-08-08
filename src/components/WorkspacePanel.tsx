import type { ReactNode } from 'react';

type WorkspacePanelProps = {
  title: string;
  icon?: ReactNode;
  /** Optional control on the right of the header, for an action that acts on this panel. */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
};

export default function WorkspacePanel({
  title,
  icon,
  action,
  children,
  className = '',
  contentClassName = '',
}: WorkspacePanelProps) {
  return (
    <section className={`flex h-full flex-col overflow-hidden rounded-md border ${className}`}>
      <div className="text-foreground flex items-center gap-2 border-b bg-accent px-3 py-2 text-sm font-medium">
        {icon ? <span className="text-inherit">{icon}</span> : null}
        <span>{title}</span>
        {action ? <span className="ml-auto">{action}</span> : null}
      </div>
      <div className={`flex-1 p-3 ${contentClassName}`}>{children}</div>
    </section>
  );
}
