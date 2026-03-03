import { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';

export type ProblemListItem = {
  id: string;
  title: string;
};

export type ProblemListCardProps = {
  problems: ProblemListItem[];
  selectedProblemId: string | null;
  onSelect: (id: string) => void;
  getBadgeContent?: (problemId: string) => ReactNode;
  title?: string;
  description?: string;
  className?: string;
  scrollAreaClassName?: string;
};

export function ProblemListCard({
  problems,
  selectedProblemId,
  onSelect,
  getBadgeContent,
  title = 'Problems',
  description,
  className = '',
  scrollAreaClassName = 'h-[520px]',
}: ProblemListCardProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className={scrollAreaClassName}>
          <ul className="divide-border divide-y">
            {problems.map((problem) => {
              const isActive = selectedProblemId === problem.id;
              const badgeContent = getBadgeContent ? getBadgeContent(problem.id) : null;

              return (
                <li key={problem.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(problem.id)}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition ${
                      isActive ? 'bg-secondary text-secondary-foreground' : 'hover:bg-slate-50'
                    }`}
                  >
                    <span className="truncate">{problem.title}</span>
                    {badgeContent ? <div className="shrink-0">{badgeContent}</div> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
