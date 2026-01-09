'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  CalendarDays,
  Pencil,
  Copy,
  CopyCheck,
  Layers as DuplicateIcon,
} from 'lucide-react';
import type { FullCourse } from '@/types/course';
import { formatInstructorNames, getStudentCount } from '@/lib/course-utils';

interface CourseHeaderProps {
  course: FullCourse;
  isStudent: boolean;
  onEditClick: () => void;
  onDuplicate?: () => void;
  onPublishToggle: (checked: boolean) => void;
  onArchiveToggle: (checked: boolean) => void;
}

export function CourseHeader({
  course,
  isStudent,
  onEditClick,
  onDuplicate,
  onPublishToggle,
  onArchiveToggle,
}: CourseHeaderProps) {
  // -- helpers ---------------------------------------------------------------
  // Get course status tag at the top
  const { status, bgColor } = require('@/lib/course-status').getCourseStatusTag(course);
  const formatRange = (start?: string | Date | null, end?: string | Date | null) => {
    const toDate = (v?: string | Date | null) =>
      !v ? null : v instanceof Date ? v : new Date(v);
    const s = toDate(start);
    const e = toDate(end);
    const fmt = new Intl.DateTimeFormat(undefined, {
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
    });
    if (!s && !e) return 'Dates TBD';
    if (s && !e) return `${fmt.format(s)} to TBD`;
    if (!s && e) return `TBD to ${fmt.format(e)}`;
    if (s && e && Number.isFinite(s.getTime()) && Number.isFinite(e.getTime())) {
      return `${fmt.format(s)} to ${fmt.format(e)}`;
    }
    return 'Invalid dates';
  };

  const regCodeFormatted = useMemo(() => {
    if (!course.regCode) return null;
    const rc = course.regCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return rc.length <= 3 ? rc : `${rc.slice(0, 3)}-${rc.slice(3)}`;
  }, [course.regCode]);

  const [copied, setCopied] = useState(false);
  const copyRegCode = async () => {
    if (!regCodeFormatted) return;
    try {
      await navigator.clipboard.writeText(regCodeFormatted);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* silent */
    }
  };

  const enrolled = course.enrolled ?? [];
  // Use helpers for clarity and reuse
  const facultyNames = formatInstructorNames(enrolled as any);

  const taList = (enrolled as any[]).filter((u:any) => u.courseRole === 'TA');
  const taNames = taList.length === 0
    ? 'None assigned'
    : taList.length === 1
      ? `${taList[0].firstName ?? ''} ${taList[0].lastName ?? ''}`.trim()
      : `${(taList[0].firstName ?? '') + (taList[0].lastName ? ' ' + taList[0].lastName : '')}`.trim() + ', ...';

  // derive metrics from the course object where possible
  type AssignmentCounts = {
    submissionCount?: number;
    commentCount?: number;
    needsGrading?: number;
    ungradedCount?: number;
    gradedCount?: number;
    dueDate?: string | Date;
  };

  const metrics = (() => {
    const assignments = Array.isArray(course.assignments) ? course.assignments.length : 0;
    const problems = Array.isArray(course.problems) ? course.problems.length : 0;
    const students = getStudentCount(enrolled as any[]);

    const submissions = Array.isArray(course.assignments)
      ? course.assignments.reduce(
          (sum, a) => sum + (Number((a as unknown as AssignmentCounts).submissionCount) || 0),
          0,
        )
      : 0;
    const comments = Array.isArray(course.assignments)
      ? course.assignments.reduce(
          (sum, a) => sum + (Number((a as unknown as AssignmentCounts).commentCount) || 0),
          0,
        )
      : 0;

    const needsGrading = Array.isArray(course.assignments)
      ? course.assignments.reduce((count, a) => {
          const ac = a as unknown as AssignmentCounts;
          const due = ac.dueDate ? (ac.dueDate instanceof Date ? ac.dueDate : new Date(ac.dueDate)) : null;
          const hasSubmissions = Boolean(Number(ac.submissionCount) > 0);
          if (due && Number.isFinite(due.getTime()) && due.getTime() < Date.now() && hasSubmissions) {
            return count + 1;
          }
          return count;
        }, 0)
      : 0;

    return { assignments, problems, students, submissions, needsGrading, comments };
  })();

  // -- render ---------------------------------------------------------------
  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <CardTitle className="text-2xl font-semibold leading-tight tracking-tight">
              <span className="mr-2 text-muted-foreground">{course.code}</span>
              {course.name}
            </CardTitle>
              {/* Course status tag (shared logic) */}
              <span
                className={`inline-block rounded ${bgColor} px-2 py-1 text-sm text-white shadow-sm ring-1 ring-gray-900/30`}
              >
                {status}
              </span>
          </div>

          {/* meta row */}
          <div className="flex flex-wrap items-center gap-5 text-sm">
            <Badge variant="secondary">{course.semester}</Badge>
            <Badge variant="outline">
              {course.credits} credit{course.credits === 1 ? '' : 's'}
            </Badge>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <CalendarDays className="h-4 w-4" aria-hidden />
              {formatRange(course.startDate, course.endDate)}
            </span>
          </div>
        </div>

        {!isStudent && (
          <div className="flex items-center gap-2">
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="secondary"
                    className="sm:hidden"
                    onClick={onEditClick}
                    aria-label="Edit course"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Edit course</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Button variant="secondary" className="hidden sm:inline-flex" onClick={onEditClick} hidden={course.isArchived}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit Course
            </Button>

            {onDuplicate && (
              <>
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        className="sm:hidden"
                        onClick={onDuplicate}
                        aria-label="Duplicate course"
                      >
                        <DuplicateIcon className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Duplicate course</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <Button variant="outline" className="hidden sm:inline-flex" onClick={onDuplicate}>
                  <DuplicateIcon className="mr-2 h-4 w-4" />
                  Duplicate Course
                </Button>
              </>
            )}
          </div>
        )}
      </CardHeader>

      {/* Three cards; spacing kept exactly as before (px-6 pt-1 pb-1 + gap-3) */}
      <CardContent className="grid gap-7 px-6 pt-1 pb-1 sm:grid-cols-2 lg:grid-cols-3">
        {!isStudent && (
          <>
            {/* Course Access (flush colored header touching border) */}
            <div className="rounded-md border">
              <div className="rounded-t-md border-b bg-sidebar/80 px-2.5 py-2 text-sm font-medium leading-none text-white">
                Course Access
              </div>
              <div className="px-2.5 pb-2.5 pt-2">
                <div className="grid grid-cols-1 gap-y-2 text-sm">
                  {/* Registration Code */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Registration Code:</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs">{regCodeFormatted ?? 'Not set'}</span>
                      {regCodeFormatted && (
                        <TooltipProvider delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={copyRegCode}
                                aria-label="Copy registration code"
                              >
                                {copied ? <CopyCheck className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{copied ? 'Copied!' : 'Copy code'}</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                  </div>

                  {/* Published */}
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">Published:</span>
                    <Switch
                      checked={course.isPublished}
                      onCheckedChange={onPublishToggle}
                      aria-label="Toggle course publishability"
                      disabled={course.isArchived}
                    />
                  </div>

                  {/* Archived */}
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">Archived:</span>
                    <Switch
                      checked={course.isArchived}
                      onCheckedChange={onArchiveToggle}
                      aria-label="Toggle course archive"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Course Staff (flush colored header touching border) */}
                <div className="rounded-md border">
                  <div className="rounded-t-md border-b bg-sidebar/80 px-2.5 py-2 text-sm font-medium leading-none text-white">
                    Course Staff
                  </div>
              <div className="px-2.5 pb-2.5 pt-2">
                <dl className="mt-1 grid gap-1.5 text-sm">
                  <div className="grid grid-cols-[90px_1fr] gap-1.5">
                    <dt className="text-xs text-muted-foreground">Instructor(s)</dt>
                    <dd className="text-xs">{facultyNames}</dd>
                  </div>
                  <div className="grid grid-cols-[90px_1fr] gap-1.5">
                    <dt className="text-xs text-muted-foreground">TAs</dt>
                    <dd className="text-xs">{taNames}</dd>
                  </div>
                </dl>
              </div>
            </div>

            {/* Course Metrics (flush colored header touching border) */}
                <div className="rounded-md border">
                  <div className="rounded-t-md border-b bg-sidebar/80 px-2.5 py-2 text-sm font-medium leading-none text-white">
                    Course Metrics
                  </div>
              <div className="px-2.5 pb-2.5 pt-2">
                <dl className="grid grid-cols-2 gap-y-1 gap-x-4 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-[11px] text-muted-foreground">Assignments</dt>
                    <dd className="font-medium">{metrics.assignments}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-[11px] text-muted-foreground">Problems</dt>
                    <dd className="font-medium">{metrics.problems}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-[11px] text-muted-foreground">Students</dt>
                    <dd className="font-medium">{metrics.students}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-[11px] text-muted-foreground">Submissions</dt>
                    <dd className="font-medium">{metrics.submissions}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-[11px] text-muted-foreground">Needs Grading</dt>
                    <dd className="font-medium">{metrics.needsGrading}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-[11px] text-muted-foreground">Comments</dt>
                    <dd className="font-medium">{metrics.comments}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
