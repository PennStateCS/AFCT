import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';

export type ProblemListItem = {
  id: string;
  title: string;
  grade?: number | null;
  maxGrade?: number | null;
  submissionsCount?: number;
  maxSubmissions?: number | null;
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
              const gradeBadge =
                problem.maxGrade !== undefined && problem.maxGrade !== null ? (
                  <Badge
                    key="grade"
                    variant="secondary"
                    title="Grade Earned / Max Points"
                    className="border border-slate-300 bg-white text-[11px] font-medium text-slate-700"
                  >
                    {problem.grade !== null && problem.grade !== undefined ? problem.grade : '-'}/
                    {problem.maxGrade}
                  </Badge>
                ) : null;
              const submissionsCount = problem.submissionsCount ?? 0;
              const hasMaxSubmissions =
                problem.maxSubmissions !== undefined && problem.maxSubmissions !== null;
              const submissionLabel = hasMaxSubmissions
                ? problem.maxSubmissions === -1
                  ? `${submissionsCount}/∞`
                  : `${submissionsCount}/${problem.maxSubmissions}`
                : `${submissionsCount}/∞`;
              const usageBadge =
                hasMaxSubmissions || submissionsCount > 0 ? (
                  <Badge
                    key="usage"
                    variant="secondary"
                    title="Submissions Used / Submissions Allowed"
                    className="border border-slate-300 bg-white text-[11px] font-medium text-slate-700"
                  >
                    {submissionLabel}
                  </Badge>
                ) : null;

              const content = badgeContent ?? (
                <div className="flex items-center gap-1">
                  {gradeBadge}
                  {usageBadge}
                </div>
              );

              return (
                <li key={problem.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(problem.id)}
                    aria-current={isActive ? 'true' : undefined}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition ${
                      isActive
                        ? 'bg-secondary text-secondary-foreground'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span className="truncate">{problem.title}</span>
                    {content}
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
