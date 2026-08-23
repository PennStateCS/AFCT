'use client';

import React from 'react';
import { Book, Check, Copy, Link as LinkIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { IdentityPanel, IdentityPanelIcon } from '@/components/IdentityPanel';
import { Button } from '@/components/ui/button';
import type { FullCourse } from '@/types/course';
import { getInstructors, type EnrolledUser } from '@/lib/course-roster';
import { showToast } from '@/lib/toast';
import { formatRegistrationCode } from '@/lib/format-registration-code';
import { LmsLinkBadge } from '@/components/lti/LmsLinkBadge';

interface CourseHeaderProps {
  course: FullCourse;
  isStudent: boolean;
}

/**
 * The course registration code plus one-click copy of the code and of a shareable
 * invite link. The code is shown grouped as `ABCD-EFGH` for readability, but the
 * copied value is the plain 8-character code the join endpoint expects; the invite
 * link is `/dashboard?joinCode=<code>`, which joins the course on open.
 */
function RegistrationCode({ code }: { code: string }) {
  const [copied, setCopied] = React.useState<null | 'code' | 'link'>(null);
  const formatted = formatRegistrationCode(code);

  const copy = async (value: string, which: 'code' | 'link', okMsg: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      showToast.success(okMsg);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      showToast.error('Could not copy to the clipboard. Select the code and copy it manually.');
    }
  };

  const copyCode = () => void copy(code, 'code', 'Registration code copied');
  const copyLink = () =>
    void copy(`${window.location.origin}/dashboard?joinCode=${code}`, 'link', 'Invite link copied');

  return (
    <span className="flex items-center gap-1.5">
      <span className="text-muted-foreground">Registration Code: </span>
      <span className="font-mono font-medium tracking-wide">{formatted}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={copyCode}
        aria-label={
          copied === 'code' ? 'Registration code copied' : `Copy registration code ${formatted}`
        }
        title="Copy registration code"
      >
        {copied === 'code' ? (
          <Check className="text-status-success h-3.5 w-3.5" />
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
          <Check className="text-status-success h-3.5 w-3.5" />
        ) : (
          <LinkIcon className="h-3.5 w-3.5" />
        )}
      </Button>
    </span>
  );
}

/**
 * The course identity panel: the icon, the title, the badges and (for staff) the
 * faculty/TA/registration line, inside its own softly tinted shell.
 *
 * ONE implementation for both views. AdminCourseView and StudentCourseView used to wrap
 * this in their own `<section className="grid grid-cols-1 gap-3">`, which meant the shell
 * was described twice and could drift; it belongs to the header, so it lives here.
 *
 * Deliberately not a Card. A Card is what ordinary content sits in on these pages, and the
 * point of this panel is that a course reads as a different kind of thing from the tables
 * below it. The tint carries none of the meaning, though: the border, the heading and the
 * badge text all stand on their own, which is what keeps it legible when the wash all but
 * disappears in high contrast.
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

  // Staff only, and complete: the header names every faculty member and TA, and the course
  // payload carries exactly those two roles.
  const staff: EnrolledUser[] = course.staff ?? [];
  const formatAllNames = (users: EnrolledUser[]) => {
    if (!Array.isArray(users) || users.length === 0) return 'None assigned';
    return users
      .map((u) => `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim())
      .filter(Boolean)
      .join(', ');
  };
  const facultyNames = formatAllNames(getInstructors(staff));
  const tas = staff.filter((u) => u.courseRole === 'TA');
  const registrationCode = (course.regCode ?? '').toUpperCase();

  // -- render ---------------------------------------------------------------
  return (
    <IdentityPanel labelledBy="course-page-title">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        {/* min-w-0 so a long course name wraps instead of pushing the badges off the
              panel. The title is never truncated here: this is the one place the whole
              name belongs. */}
        <h1
          id="course-page-title"
          className="flex min-w-0 flex-1 items-start gap-3 text-2xl leading-tight font-semibold tracking-tight"
        >
          {/* The same emerald Book as the Courses list and the dashboard's Courses
                module, so a course reads as the same kind of thing wherever it appears. */}
          <IdentityPanelIcon icon={Book} />
          {/* One title, one colour. The code used to be muted and the name foreground,
                which broke "CMPSC 131: Programming and Computation I" into two ranks for no
                reason; its position already tells you which part is the code. */}
          <span className="min-w-0">
            {course.code}: {course.name}
          </span>
        </h1>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Badge variant="secondary">{course.semester}</Badge>
          <Badge variant="outline">
            {course.credits} credit{course.credits === 1 ? '' : 's'}
          </Badge>
          <Badge variant={courseStatus.theme.variant}>{courseStatus.label}</Badge>
          {/* Only staff receive `lmsLinks`, so this is empty for a student and renders
                nothing. It sits last because it is the one badge that is often absent, and
                a row that changes length at the end is easier to read than one that shifts
                in the middle. */}
          {!isStudent && <LmsLinkBadge links={course.lmsLinks ?? []} />}
        </div>
      </div>

      {/* Faculty, TAs (only when there are any), then the registration code + copy.
            Indented to the title's text rather than the panel edge on wide screens, so the
            identity block reads as one column. */}
      {!isStudent && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm sm:pl-[3.75rem]">
          <span>
            <span className="text-muted-foreground">Faculty: </span>
            <span className="font-medium">{facultyNames}</span>
          </span>
          {tas.length > 0 && (
            <span>
              <span className="text-muted-foreground">TAs: </span>
              <span className="font-medium">{formatAllNames(tas)}</span>
            </span>
          )}
          {registrationCode ? <RegistrationCode code={registrationCode} /> : null}
        </div>
      )}
    </IdentityPanel>
  );
}
