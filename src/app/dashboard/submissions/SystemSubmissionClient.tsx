'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SearchableMultiSelect } from '@/components/ui/SearchableMultiSelect';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Eye, Download, RefreshCw, FileText } from 'lucide-react';
import { showToast } from '@/lib/toast';

type StatusTone = 'green' | 'amber' | 'red' | 'gray' | 'blue' | 'violet' | 'yellow' | 'lime' | 'pink';

type StatusChip = {
  label: string;
  tone: StatusTone;
  title: string;
};

type SystemSubmission = {
  id: string;
  submittedAt: string;
  course: string;
  assignment: string;
  fileName?: string | null;
  originalFileName?: string | null;
  status: string;
  correct?: boolean | null;
  feedback?: string | null;
};

type SubmissionStatusFilter = 'on-time' | 'late' | 'pending' | 'processing' | 'failed' | 'correct' | 'incorrect';

const statusToneClass: Record<StatusTone, string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-rose-500',
  gray: 'bg-slate-400',
  blue: 'bg-sky-500',
  violet: 'bg-violet-500',
  yellow: 'bg-yellow-300',
  lime: 'bg-lime-400',
  pink: 'bg-pink-500',
};

const STATUS_FILTER_OPTIONS: { value: SubmissionStatusFilter; label: string; dot: string }[] = [
  { value: 'on-time', label: 'On time', dot: 'bg-emerald-500' },
  { value: 'late', label: 'Late', dot: 'bg-amber-500' },
  { value: 'pending', label: 'Pending', dot: 'bg-violet-500' },
  { value: 'processing', label: 'Processing', dot: 'bg-yellow-300' },
  { value: 'failed', label: 'Failed', dot: 'bg-pink-500' },
  { value: 'correct', label: 'Correct', dot: 'bg-sky-500' },
  { value: 'incorrect', label: 'Incorrect', dot: 'bg-rose-500' },
];

const getSubmissionReviewStatus = (submission: SystemSubmission): SubmissionStatusFilter => {
  const status = submission.status?.toLowerCase() ?? '';
  if (status === 'processing') return 'processing';
  if (status === 'pending') return 'pending';
  if (status === 'failed') return 'failed';
  if (submission.correct === true) return 'correct';
  return 'incorrect';
};

const filterSubmissions = (
  submissions: SystemSubmission[],
  activeFilters: Set<SubmissionStatusFilter>,
): SystemSubmission[] => {
  if (activeFilters.size === 0) return submissions;
  return submissions.filter((submission) => {
    const reviewStatus = getSubmissionReviewStatus(submission);
    const isLate = submission.status?.toLowerCase() === 'late';

    if (activeFilters.has('late') && isLate) return true;
    if (activeFilters.has('on-time') && !isLate) return true;
    if (activeFilters.has(reviewStatus)) return true;
    return false;
  });
};

const getStatusChip = (submission: SystemSubmission): StatusChip => {
  const status = submission.status?.toLowerCase() ?? '';

  if (status === 'pending') {
    return { label: 'Pending', tone: 'violet', title: 'Submission analysis is pending' };
  }

  if (status === 'processing') {
    return { label: 'Processing', tone: 'yellow', title: 'Submission is being processed' };
  }

  if (status === 'failed') {
    return { label: 'Failed', tone: 'pink', title: 'Submission analysis failed' };
  }

  if (submission.correct === true) {
    return { label: 'Correct', tone: 'blue', title: 'Submission is correct' };
  }

  return { label: 'Incorrect', tone: 'red', title: 'Submission is incorrect' };
};

export default function SystemSubmissionClient() {
  const [selectedCourses, setSelectedCourses] = useState<string[]>([]);
  const [selectedAssignments, setSelectedAssignments] = useState<string[]>([]);
  const [activeFilters, setActiveFilters] = useState<Set<SubmissionStatusFilter>>(new Set());
  const [submissions] = useState<SystemSubmission[]>([]);

  const courseOptions = useMemo(
    () =>
      Array.from(new Set(submissions.map((submission) => submission.course)))
        .sort()
        .map((course) => ({ id: course, label: course })),
    [submissions],
  );

  const assignmentOptions = useMemo(
    () =>
      Array.from(new Set(submissions.map((submission) => submission.assignment)))
        .sort()
        .map((assignment) => ({ id: assignment, label: assignment })),
    [submissions],
  );

  const visibleSubmissions = useMemo(() => {
    return filterSubmissions(
      submissions.filter((submission) => {
        const matchesCourse =
          selectedCourses.length === 0 || selectedCourses.includes(submission.course);
        const matchesAssignment =
          selectedAssignments.length === 0 || selectedAssignments.includes(submission.assignment);
        return matchesCourse && matchesAssignment;
      }),
      activeFilters,
    );
  }, [activeFilters, selectedAssignments, selectedCourses, submissions]);

  const toggleFilter = (filter: SubmissionStatusFilter) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(filter)) next.delete(filter);
      else next.add(filter);
      return next;
    });
  };

  const handleRerunVisible = () => {
    if (visibleSubmissions.length === 0) return;
    showToast.success('Rerun requested for visible submissions');
  };

  const handleRerunSubmission = (submission: SystemSubmission) => {
    showToast.success(`Rerun requested for ${submission.originalFileName || submission.id}`);
  };

  const handleDownload = (submission: SystemSubmission) => {
    if (!submission.fileName) return;
    const url = `/api/uploads/submissions/${encodeURIComponent(submission.fileName)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <Card className="p-4">
      <CardHeader className="flex flex-col gap-4 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle role="heading" aria-level={1} className="text-2xl">
            System Logs
          </CardTitle>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={handleRerunVisible}
          disabled={visibleSubmissions.length === 0}
          className="whitespace-nowrap"
          title="Rerun Visible Submissions"
        >
          Rerun
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
          <SearchableMultiSelect
            label="Course filter"
            items={courseOptions}
            value={selectedCourses}
            onChange={setSelectedCourses}
            placeholder="All courses"
            searchPlaceholder="Search courses"
            emptyStateText="No courses found."
          />
          <SearchableMultiSelect
            label="Assignment filter"
            items={assignmentOptions}
            value={selectedAssignments}
            onChange={setSelectedAssignments}
            placeholder="All assignments"
            searchPlaceholder="Search assignments"
            emptyStateText="No assignments found."
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveFilters(new Set())}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              activeFilters.size === 0
                ? 'border-foreground bg-foreground text-background'
                : 'border-border text-muted-foreground hover:border-foreground/50 hover:text-foreground'
            }`}
          >
            All
          </button>
          {STATUS_FILTER_OPTIONS.map(({ value, label, dot }) => {
            const active = activeFilters.has(value);
            return (
              <button
                key={value}
                type="button"
                onClick={() => toggleFilter(value)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border text-muted-foreground hover:border-foreground/50 hover:text-foreground'
                }`}
              >
                <span className={`inline-flex h-2.5 w-2.5 rounded-full ${dot}`} aria-hidden="true" />
                {label}
              </button>
            );
          })}
        </div>

        <div className="overflow-x-auto rounded-md border">
          <Table className="text-sm">
            <TableHeader>
              <TableRow>
                <TableHead className="px-2 py-2">Course</TableHead>
                <TableHead className="px-2 py-2">Assignment</TableHead>
                <TableHead className="px-2 py-2">Submitted</TableHead>
                <TableHead className="px-2 py-2">Status</TableHead>
                <TableHead className="px-2 py-2">Manage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleSubmissions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground py-8 text-center text-sm">
                    No system submissions match your filters.
                  </TableCell>
                </TableRow>
              ) : (
                visibleSubmissions.map((submission) => {
                  const statusChip = getStatusChip(submission);
                  return (
                    <TableRow key={submission.id} className="hover:bg-slate-50">
                      <TableCell className="px-2 py-2 align-top">{submission.course}</TableCell>
                      <TableCell className="px-2 py-2 align-top">{submission.assignment}</TableCell>
                      <TableCell className="px-2 py-2 align-top">{new Date(submission.submittedAt).toLocaleString()}</TableCell>
                      <TableCell className="px-2 py-2 align-top">
                        <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-2 py-1 text-xs font-medium">
                          <span className={`inline-flex h-2.5 w-2.5 rounded-full ${statusToneClass[statusChip.tone]}`} aria-hidden="true" />
                          {statusChip.label}
                        </span>
                      </TableCell>
                      <TableCell className="px-2 py-2 align-top">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="secondary" className="whitespace-nowrap">
                              Manage
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem className="flex items-center gap-2" onClick={() => showToast.info(`Viewing ${submission.originalFileName || submission.id}`)}>
                              <Eye className="h-4 w-4" /> View details
                            </DropdownMenuItem>
                            <DropdownMenuItem className="flex items-center gap-2" disabled={submission.status?.toLowerCase() === 'processing'} onClick={() => handleRerunSubmission(submission)}>
                              <RefreshCw className="h-4 w-4" /> Rerun evaluator
                            </DropdownMenuItem>
                            <DropdownMenuItem className="flex items-center gap-2" onClick={() => handleDownload(submission)} disabled={!submission.fileName}>
                              <Download className="h-4 w-4" /> Download submission
                            </DropdownMenuItem>
                            <DropdownMenuItem className="flex items-center gap-2" onClick={() => showToast.info('View raw submission JSON')}>
                              <FileText className="h-4 w-4" /> View raw JSON
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
