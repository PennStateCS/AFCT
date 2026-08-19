/**
 * Where a launch lands when it cannot land in a course, and what to say about it.
 *
 * A launch that has nowhere to go used to stop on a page of its own, which was honest and a
 * dead end: somebody who clicked their LMS link saw one sentence and no way on. The dashboard
 * is a better answer, because their other courses are there and the one they were after appears
 * the moment it is ready. But a silent redirect is worse than the dead end, since it looks like
 * the link went to the wrong place, so the reason travels with them.
 *
 * The reason is a fixed word rather than a message, so nothing an LMS says reaches the page as
 * text. Only the course title is carried across, which is the LMS's own words for a course this
 * person is genuinely in.
 */

/** Why somebody was sent to the dashboard instead of a course. */
export type LaunchNotice =
  /** No AFCT course is connected to this LMS course, and they cannot connect one. */
  | 'not-linked'
  /** Connected, but the course is not published, so a student cannot see it yet. */
  | 'not-published'
  /** They could connect one, but there is no course in AFCT to connect it to. */
  | 'no-courses'
  /** Connected to an AFCT course that has since been deleted. */
  | 'course-missing'
  /** The link names an assignment that is not open to students yet. */
  | 'assignment-not-open';

/**
 * An LMS course title is somebody else's text, so it is bounded before it becomes a URL.
 *
 * Long enough for any real course name; short enough that a hostile one cannot push a URL past
 * what a browser or a proxy will carry.
 */
const MAX_TITLE = 80;

export function dashboardWithNotice(notice: LaunchNotice, contextTitle?: string | null): string {
  return withNotice('/dashboard', notice, contextTitle);
}

/**
 * The same notice, on the course itself.
 *
 * Used when the person can see the course but not the thing the link named, which is what an
 * unpublished assignment is: sending them to the dashboard would take them further from their
 * work than they already are.
 */
export function courseWithNotice(
  courseId: string,
  notice: LaunchNotice,
  title?: string | null,
): string {
  return withNotice(`/dashboard/courses/${courseId}`, notice, title);
}

function withNotice(path: string, notice: LaunchNotice, title?: string | null): string {
  const params = new URLSearchParams({ lms: notice });
  const named = title?.trim();
  if (named) params.set('course', named.slice(0, MAX_TITLE));
  return `${path}?${params.toString()}`;
}

/** Whether a query value is a notice this build knows, so an invented one shows nothing. */
export function asLaunchNotice(value: string | null | undefined): LaunchNotice | null {
  switch (value) {
    case 'not-linked':
    case 'not-published':
    case 'no-courses':
    case 'course-missing':
    case 'assignment-not-open':
      return value;
    default:
      return null;
  }
}

/**
 * What the dashboard says about it.
 *
 * Written for the person reading it rather than about the system: a student is told the course
 * is not open yet and that it will appear here, because that is what they can act on, and a
 * member of staff is told what is missing and who creates it.
 */
export function launchNoticeMessage(notice: LaunchNotice, courseTitle: string | null): string {
  const named = courseTitle ? `"${courseTitle}"` : 'that course';

  switch (notice) {
    case 'not-linked':
      return `${named} in your LMS is not connected to AFCT yet, so there is nothing to open. Your instructor connects it, and it will appear here once they have.`;
    case 'not-published':
      return `${named} is not open to students yet. You are enrolled, and it will appear here as soon as your instructor publishes it.`;
    case 'no-courses':
      return `${named} in your LMS cannot be connected yet, because you are not on the staff of any AFCT course. An administrator creates the course, then opening the link again will offer to connect it.`;
    case 'course-missing':
      return `${named} in your LMS was connected to an AFCT course that no longer exists. Ask your instructor to connect it again.`;
    case 'assignment-not-open':
      // Named for the assignment rather than the LMS course here, since that is what they clicked.
      return `${named} is not open yet. Your instructor publishes it when it is ready, and the rest of the course is below in the meantime.`;
  }
}
