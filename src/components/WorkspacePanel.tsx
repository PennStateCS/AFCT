import { ReactNode } from 'react';

type WorkspacePanelProps = {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
};

export default function WorkspacePanel({
  title,
  icon,
  children,
  className = '',
  contentClassName = '',
}: WorkspacePanelProps) {
  return (
    <section className={`flex h-full flex-col overflow-hidden rounded-md border ${className}`}>
      <div className="flex items-center gap-2 border-b bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700">
        {icon ? <span className="text-inherit">{icon}</span> : null}
        <span>{title}</span>
      </div>
      <div className={`flex-1 p-3 ${contentClassName}`}>{children}</div>
    </section>
  );
}
