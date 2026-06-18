'use client';

import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Pencil,
  Copy,
  CopyCheck,
  Layers as DuplicateIcon,
  Users,
  ClipboardList,
  BookOpen,
  Inbox,
} from 'lucide-react';
import type { FullCourse } from '@/types/course';
import { getInstructors, getStudentCount } from '@/lib/course-utils';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { formatDateTimeInTimeZone } from '@/lib/date';

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
  const { timezone } = useEffectiveTimezone();
  // -- helpers ---------------------------------------------------------------
  // Get course status tag at the top
  const regCodeFormatted = useMemo(() => {
    if (!course.regCode) return null;
    const rc = course.regCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return rc.length <= 3 ? rc : `${rc.slice(0, 3)}-${rc.slice(3)}`;
  }, [course.regCode]);

  const normalizeDate = (value?: string | Date | null) => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  };
  const startDate = normalizeDate(course.startDate);
  const endDate = normalizeDate(course.endDate);
  const registrationOpenAt = normalizeDate(course.registrationOpenAt);
  const registrationCloseAt = normalizeDate(course.registrationCloseAt);
  const formatRegistrationDate = (value: Date | null) =>
    value ? formatDateTimeInTimeZone(value, timezone) : 'Not set';
  const formatCourseDate = (value: Date | null) =>
    value ? formatDateTimeInTimeZone(value, timezone) : 'Not set';
  const badgeTheme = {
    upcoming: { variant: 'info' as const },
    open: { variant: 'success' as const },
    closed: { variant: 'neutral' as const },
  } as const;

  const registrationStatus = (() => {
    if (!registrationOpenAt || !registrationCloseAt) {
      return {
        label: 'Closed',
        theme: badgeTheme.closed,
        detail: null,
      };
    }
    const now = Date.now();
    if (now >= registrationOpenAt.getTime() && now <= registrationCloseAt.getTime()) {
      return {
        label: 'Open',
        theme: badgeTheme.open,
        detail: `Closes ${formatDateTimeInTimeZone(registrationCloseAt, timezone)}`,
      };
    }
    if (now < registrationOpenAt.getTime()) {
      return {
        label: 'Upcoming',
        theme: badgeTheme.upcoming,
        detail: `Opens ${formatDateTimeInTimeZone(registrationOpenAt, timezone)}`,
      };
    }
    return {
      label: 'Closed',
      theme: badgeTheme.closed,
      detail: `Closed ${formatDateTimeInTimeZone(registrationCloseAt, timezone)}`,
    };
  })();

  const courseStatus = (() => {
    if (!startDate || !endDate) {
      return { label: 'Upcoming', theme: badgeTheme.upcoming };
    }
    const now = Date.now();
    if (now < startDate.getTime()) {
      return { label: 'Upcoming', theme: badgeTheme.upcoming };
    }
    if (now > endDate.getTime()) {
      return { label: 'Closed', theme: badgeTheme.closed };
    }
    return { label: 'Open', theme: badgeTheme.open };
  })();

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
  const formatAllFacultyNames = (users: any[]) => {
    if (!Array.isArray(users) || users.length === 0) return 'None assigned';
    return users
      .map((u) => `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim())
      .filter(Boolean)
      .join(', ');
  };
  const facultyNames = formatAllFacultyNames(
    getInstructors(enrolled as any).filter((u: any) => u.role !== 'ADMIN'),
  );

  const taList = (enrolled as any[]).filter((u: any) => u.courseRole === 'TA');
  const taNames =
    taList.length === 0
      ? 'None assigned'
      : taList.length === 1
        ? `${taList[0].firstName ?? ''} ${taList[0].lastName ?? ''}`.trim()
        : `${(taList[0].firstName ?? '') + (taList[0].lastName ? ' ' + taList[0].lastName : '')}`.trim() +
          ', ...';

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
          const due = ac.dueDate
            ? ac.dueDate instanceof Date
              ? ac.dueDate
              : new Date(ac.dueDate)
            : null;
          const hasSubmissions = Boolean(Number(ac.submissionCount) > 0);
          if (
            due &&
            Number.isFinite(due.getTime()) &&
            due.getTime() < Date.now() &&
            hasSubmissions
          ) {
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
            <CardTitle
              id="course-page-title"
              role="heading"
              aria-level={1}
              className="text-2xl leading-tight font-semibold tracking-tight"
            >
              <span className="text-muted-foreground">{course.code}</span>
              <span className="text-muted-foreground">: </span>
              {course.name}
            </CardTitle>
          </div>

          {/* meta row */}
          <div className="flex flex-wrap items-center gap-5 text-sm">
            <Badge variant="secondary">{course.semester}</Badge>
            <Badge variant="outline">
              {course.credits} credit{course.credits === 1 ? '' : 's'}
            </Badge>
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
            <Button
              variant="secondary"
              className="hidden sm:inline-flex"
              onClick={onEditClick}
              hidden={course.isArchived}
            >
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
      <CardContent className="grid gap-7 px-6 pt-1 pb-1 sm:grid-cols-2 lg:grid-cols-4">
        {!isStudent && (
          <>
            {/* Course Access (flush colored header touching border) */}
            <div className="rounded-md border">
              <div className="bg-sidebar/80 rounded-t-md border-b px-2.5 py-2 text-sm leading-none font-medium text-white">
                Course Access
              </div>
              <div className="px-2.5 pt-2 pb-2.5">
                <div className="grid grid-cols-1 gap-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">Status</span>
                    <Badge variant={courseStatus.theme.variant}>
                      {courseStatus.label}
                    </Badge>
                  </div>
                  {/* Published */}
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-[11px]">Published</span>
                    <Switch
                      checked={course.isPublished}
                      onCheckedChange={onPublishToggle}
                      aria-label="Toggle course publishability"
                      disabled={course.isArchived}
                    />
                  </div>

                  {/* Archived */}
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-[11px]">Archived</span>
                    <Switch
                      checked={course.isArchived}
                      onCheckedChange={onArchiveToggle}
                      aria-label="Toggle course archive"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-[11px]">Start Date</span>
                    <span className="text-right text-xs leading-snug">
                      {formatCourseDate(startDate)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-[11px]">End Date</span>
                    <span className="text-right text-xs leading-snug">
                      {formatCourseDate(endDate)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Self Registration (flush colored header touching border) */}
            <div className="rounded-md border">
              <div className="bg-sidebar/80 rounded-t-md border-b px-2.5 py-2 text-sm leading-none font-medium text-white">
                Self Registration
              </div>
              <div className="px-2.5 pt-2 pb-2.5">
                <div className="grid gap-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">Status</span>
                    <Badge variant={registrationStatus.theme.variant}>
                      {registrationStatus.label}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">Registration Code</span>
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
                                {copied ? (
                                  <CopyCheck className="h-4 w-4" />
                                ) : (
                                  <Copy className="h-4 w-4" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{copied ? 'Copied!' : 'Copy code'}</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">Opens</span>
                    <span className="text-right text-xs leading-snug">
                      {formatRegistrationDate(registrationOpenAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">Closes</span>
                    <span className="text-right text-xs leading-snug">
                      {formatRegistrationDate(registrationCloseAt)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Course Staff (flush colored header touching border) */}
            <div className="rounded-md border">
              <div className="bg-sidebar/80 rounded-t-md border-b px-2.5 py-2 text-sm leading-none font-medium text-white">
                Course Staff
              </div>
              <div className="px-2.5 pt-2 pb-2.5">
                <dl className="mt-1 grid gap-1.5 text-sm">
                  <div className="grid grid-cols-[90px_1fr] gap-1.5">
                    <dt className="text-muted-foreground text-xs">Faculty</dt>
                    <dd className="text-xs">{facultyNames}</dd>
                  </div>
                  <div className="grid grid-cols-[90px_1fr] gap-1.5">
                    <dt className="text-muted-foreground text-xs">TAs</dt>
                    <dd className="text-xs">{taNames}</dd>
                  </div>
                </dl>
              </div>
            </div>

            {/* Course Metrics (flush colored header touching border) */}
            <div className="rounded-md border">
              <div className="bg-sidebar/80 rounded-t-md border-b px-2.5 py-2 text-sm leading-none font-medium text-white">
                Course Metrics
              </div>
              <div className="px-2.5 pt-2 pb-2.5">
                <dl className="grid gap-1.5 text-sm">
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
                      <Users className="h-3.5 w-3.5 text-blue-500" aria-hidden />
                      Students
                    </dt>
                    <dd className="font-medium">{metrics.students}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
                      <ClipboardList className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
                      Assignments
                    </dt>
                    <dd className="font-medium">{metrics.assignments}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
                      <BookOpen className="h-3.5 w-3.5 text-amber-500" aria-hidden />
                      Problems
                    </dt>
                    <dd className="font-medium">{metrics.problems}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
                      <Inbox className="h-3.5 w-3.5 text-purple-500" aria-hidden />
                      Submissions
                    </dt>
                    <dd className="font-medium">{metrics.submissions}</dd>
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
