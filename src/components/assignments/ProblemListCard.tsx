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
  /** When set, the leading number for the first 9 problems is announced as a 1-9 keyboard shortcut. */
  numberShortcuts?: boolean;
  /** Show the "submissions used / allowed" badge next to the grade. Default true; the staff
   * submissions view hides it since attempts aren't relevant when grading. */
  showSubmissionUsage?: boolean;
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
  numberShortcuts = false,
  showSubmissionUsage = true,
}: ProblemListCardProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className={scrollAreaClassName}>
          <ul className="divide-border divide-y">
            {problems.map((problem, index) => {
              const isActive = selectedProblemId === problem.id;
              const badgeContent = getBadgeContent ? getBadgeContent(problem.id) : null;
              const gradeBadge =
                problem.maxGrade !== undefined && problem.maxGrade !== null ? (
                  <Badge
                    key="grade"
                    variant="secondary"
                    title="Grade Earned / Max Points"
                    className="border border-slate-300 bg-white text-xs font-medium text-slate-700"
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
                showSubmissionUsage && (hasMaxSubmissions || submissionsCount > 0) ? (
                  <Badge
                    key="usage"
                    variant="secondary"
                    title="Submissions Used / Submissions Allowed"
                    className="border border-slate-300 bg-white text-xs font-medium text-slate-700"
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

              const shortcut = numberShortcuts && index < 9 ? String(index + 1) : undefined;

              return (
                <li key={problem.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(problem.id)}
                    aria-current={isActive ? 'true' : undefined}
                    aria-keyshortcuts={shortcut}
                    title={shortcut ? `Press ${shortcut} to select` : undefined}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition ${
                      isActive
                        ? 'bg-secondary text-secondary-foreground'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="text-muted-foreground shrink-0 tabular-nums">
                        {index + 1}.
                      </span>
                      <span className="truncate">{problem.title}</span>
                    </span>
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
