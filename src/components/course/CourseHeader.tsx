'use client';

import React from 'react';
import { Check, Copy, Link as LinkIcon } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { FullCourse } from '@/types/course';
import { getInstructors, type EnrolledUser } from '@/lib/course-utils';
import { showToast } from '@/lib/toast';

interface CourseHeaderProps {
  course: FullCourse;
  isStudent: boolean;
}

/**
 * The course join (registration) code plus one-click copy of the code and of a
 * shareable invite link. The code is shown grouped as `ABCD-EFGH` for readability,
 * but the copied value is the plain 8-character code the join endpoint expects; the
 * invite link is `/dashboard?joinCode=<code>`, which joins the course on open.
 */
function JoinCode({ code }: { code: string }) {
  const [copied, setCopied] = React.useState<null | 'code' | 'link'>(null);
  const formatted = code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;

  const copy = async (value: string, which: 'code' | 'link', okMsg: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      showToast.success(okMsg);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      showToast.error('Could not copy to the clipboard');
    }
  };

  const copyCode = () => void copy(code, 'code', 'Join code copied');
  const copyLink = () =>
    void copy(`${window.location.origin}/dashboard?joinCode=${code}`, 'link', 'Invite link copied');

  return (
    <span className="flex items-center gap-1.5">
      <span className="text-muted-foreground">Join code: </span>
      <span className="font-mono font-medium tracking-wide">{formatted}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={copyCode}
        aria-label={copied === 'code' ? 'Join code copied' : `Copy join code ${formatted}`}
        title="Copy join code"
      >
        {copied === 'code' ? (
          <Check className="h-3.5 w-3.5 text-green-600" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={copyLink}
        aria-label={copied === 'link' ? 'Invite link copied' : 'Copy invite link'}
        title="Copy invite link"
      >
        {copied === 'link' ? (
          <Check className="h-3.5 w-3.5 text-green-600" />
        ) : (
          <LinkIcon className="h-3.5 w-3.5" />
        )}
      </Button>
    </span>
  );
}

/**
 * The inner header content: title, badges, course status, and (for staff) the
 * faculty/TA line. Extracted so it can sit either in its own card (student view)
 * or above the tab bar in the admin card.
 */
export function CourseHeaderContent({ course, isStudent }: CourseHeaderProps) {
  const normalizeDate = (value?: string | Date | null) => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  };
  const startDate = normalizeDate(course.startDate);
  const endDate = normalizeDate(course.endDate);

  const badgeTheme = {
    upcoming: { variant: 'info' as const },
    open: { variant: 'success' as const },
    closed: { variant: 'neutral' as const },
  } as const;

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

  const enrolled = course.enrolled ?? [];
  const formatAllNames = (users: EnrolledUser[]) => {
    if (!Array.isArray(users) || users.length === 0) return 'None assigned';
    return users
      .map((u) => `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim())
      .filter(Boolean)
      .join(', ');
  };
  const facultyNames = formatAllNames(getInstructors(enrolled));
  const tas = enrolled.filter((u) => u.courseRole === 'TA');
  const joinCode = (course.regCode ?? '').toUpperCase();

  // -- render ---------------------------------------------------------------
  return (
    <>
      {/* Title on the left; badges pinned to the top-right of the card */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
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

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{course.semester}</Badge>
          <Badge variant="outline">
            {course.credits} credit{course.credits === 1 ? '' : 's'}
          </Badge>
          <Badge variant={courseStatus.theme.variant}>{courseStatus.label}</Badge>
        </div>
      </div>

      {/* Faculty, TAs (only when there are any), then the join code + copy */}
      {!isStudent && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <span>
            <span className="text-muted-foreground">Faculty: </span>
            {facultyNames}
          </span>
          {tas.length > 0 && (
            <span>
              <span className="text-muted-foreground">TAs: </span>
              {formatAllNames(tas)}
            </span>
          )}
          {joinCode ? <JoinCode code={joinCode} /> : null}
        </div>
      )}
    </>
  );
}

/** Standalone header card (student view; the admin view embeds the tab bar). */
export function CourseHeader({ course, isStudent }: CourseHeaderProps) {
  return (
    <Card>
      <CardHeader className="grid grid-cols-1 gap-3">
        <CourseHeaderContent course={course} isStudent={isStudent} />
      </CardHeader>
    </Card>
  );
}
