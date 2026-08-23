import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canManageCourse } from '@/lib/permissions';
import { resolveCourseTimezone } from '@/lib/course-timezone';
import { toISODate } from '@/lib/date-format';

export const metadata: Metadata = {
  title: 'Add an AFCT assignment',
};

/**
 * Choosing what an LMS link should open: an assignment that already exists, or a new one.
 *
 * A plain form that posts to AFCT, which answers with the page that returns to the LMS. No
 * client JavaScript: the whole flow is server-rendered steps, and it works if a script is
 * blocked, which matters because an LMS draws this inside its own modal.
 *
 * Read here rather than fetched so the list is right on first paint and can never include an
 * assignment from a course this person does not run.
 */
export default async function DeepLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ pending?: string; mode?: string; error?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const { pending: pendingId, mode, error } = await searchParams;

  const pending = pendingId
    ? await prisma.ltiPendingDeepLink.findFirst({
        // Scoped to the caller, so somebody else's request is simply not found.
        where: { id: pendingId, userId: session.user.id, expiresAt: { gt: new Date() } },
        select: { id: true, contextId: true, platformId: true },
      })
    : null;

  if (!pending) {
    return (
      <Shell title="This request has expired">
        <p className="text-muted-foreground text-sm">
          Go back to your LMS and add the AFCT link again.
        </p>
      </Shell>
    );
  }

  const link = pending.contextId
    ? await prisma.ltiContextLink.findUnique({
        where: {
          platformId_contextId: { platformId: pending.platformId, contextId: pending.contextId },
        },
        select: { id: true, courseId: true, course: { select: { name: true } } },
      })
    : null;

  if (!link) {
    return (
      <Shell title="Connect this course first">
        <p className="text-muted-foreground text-sm">
          AFCT does not know which course this is yet. Open the AFCT link from this course once and
          choose the course, then add an assignment link.
        </p>
      </Shell>
    );
  }

  // The person choosing must run the course, or a deep link becomes a way to attach somebody
  // else's assignment to your own LMS course.
  if (!(await canManageCourse(session.user, link.courseId))) {
    return (
      <Shell title="You cannot choose for this course">
        <p className="text-muted-foreground text-sm">
          Only the people who run {link.course.name} in AFCT can add its assignments to your LMS.
        </p>
      </Shell>
    );
  }

  /**
   * What this LMS course may still be given, in two kinds.
   *
   * Adding the same assignment twice gives the LMS two links and two gradebook columns for one
   * piece of work, and the grades then disagree, so an assignment a link already opens is not
   * offered. Those are counted rather than listed, because naming them would not help: they
   * are visible in the LMS itself.
   *
   * An unconfirmed link is the awkward middle. AFCT wrote the row when it returned the
   * response and has heard nothing since, so the assignment may be sitting in this LMS course
   * or may have been refused on the way in. Hiding it means somebody whose link was refused can
   * never add it again; offering it silently invites a second copy of one that is really there.
   * So it is offered under its own heading, with the warning next to it.
   */
  const [assignments, unconfirmed, linkedCount] = await Promise.all([
    prisma.assignment.findMany({
      where: { courseId: link.courseId, ltiDeepLinks: { none: { contextLinkId: link.id } } },
      select: { id: true, title: true, problems: { select: { maxPoints: true } } },
      orderBy: { dueDate: 'asc' },
    }),
    prisma.assignment.findMany({
      where: {
        courseId: link.courseId,
        ltiDeepLinks: { some: { contextLinkId: link.id, confirmedAt: null } },
      },
      select: { id: true, title: true, problems: { select: { maxPoints: true } } },
      orderBy: { dueDate: 'asc' },
    }),
    prisma.ltiDeepLink.count({
      where: { contextLinkId: link.id, confirmedAt: { not: null } },
    }),
  ]);

  const failure = error ? MESSAGES[error] : null;

  if (mode === 'create') {
    // Dated in the course's own timezone, which is what the assignment routes store against.
    const timezone = await resolveCourseTimezone(link.courseId);
    const today = toISODate(new Date(new Date().toLocaleString('en-US', { timeZone: timezone })));

    return (
      <Shell title="New assignment">
        <p className="text-muted-foreground mb-4 text-sm">
          This creates the assignment in {link.course.name} and adds a link to it. You can add
          problems and change anything else in AFCT afterwards.
        </p>
        {failure}

        <form method="POST" action="/api/lti/deep-link" className="space-y-4">
          <input type="hidden" name="pendingId" value={pending.id} />
          <input type="hidden" name="mode" value="create" />

          <Field label="Title" htmlFor="title">
            <input
              id="title"
              name="title"
              required
              maxLength={200}
              autoFocus
              placeholder="Problem set 1"
              className="border-input bg-card h-9 w-full rounded-md border px-3 text-sm"
            />
          </Field>

          <Field label="Due date" htmlFor="dueDate">
            <input
              id="dueDate"
              name="dueDate"
              type="date"
              required
              defaultValue={today}
              className="border-input bg-card h-9 w-full rounded-md border px-3 text-sm"
            />
          </Field>

          <Field
            label="Available from (optional)"
            htmlFor="unlockAt"
            hint="Leave empty to make it available straight away."
          >
            <input
              id="unlockAt"
              name="unlockAt"
              type="date"
              className="border-input bg-card h-9 w-full rounded-md border px-3 text-sm"
            />
          </Field>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="isPublished"
              value="on"
              defaultChecked
              className="mt-0.5"
            />
            <span>
              Publish it now
              <span className="text-muted-foreground block text-xs">
                An unpublished assignment is not visible to students, so the link would open nothing
                for them.
              </span>
            </span>
          </label>

          <div className="flex items-center gap-3">
            <Submit>Create and add it</Submit>
            <a
              href={`/lti/deep-link?pending=${pending.id}`}
              className="text-muted-foreground text-sm underline"
            >
              Back
            </a>
          </div>
        </form>
      </Shell>
    );
  }

  if (mode === 'connect') {
    if (assignments.length === 0 && unconfirmed.length === 0) {
      return (
        <Shell title="Nothing left to add">
          <p className="text-muted-foreground mb-4 text-sm">
            {linkedCount > 0
              ? `Every assignment in ${link.course.name} has already been added to this course in your LMS.`
              : `${link.course.name} has no assignments yet.`}
          </p>
          <a
            href={`/lti/deep-link?pending=${pending.id}&mode=create`}
            className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center rounded-md px-4 text-sm font-medium"
          >
            Create a new assignment
          </a>
        </Shell>
      );
    }

    return (
      <Shell title="Which assignment?">
        <p className="text-muted-foreground mb-4 text-sm">
          Choose the {link.course.name} assignment this link should open.
          {linkedCount > 0
            ? ` ${linkedCount} already added to this course ${linkedCount === 1 ? 'is' : 'are'} not listed.`
            : ''}
        </p>
        {unconfirmed.length > 0 ? (
          <p className="text-muted-foreground mb-4 text-sm">
            The assignments under <strong>Added before, but never opened</strong> were sent to this
            course already. Nobody has opened one from your LMS since, so AFCT cannot tell whether
            it arrived. Open it in your LMS to find out, and add it here again only if it is
            genuinely missing: adding a second one gives you two links and two gradebook columns for
            the same work.
          </p>
        ) : null}
        {failure}

        <form method="POST" action="/api/lti/deep-link" className="space-y-4">
          <input type="hidden" name="pendingId" value={pending.id} />
          <input type="hidden" name="mode" value="connect" />

          {/* A select rather than a list of radios. A term's worth of assignments is easily
              thirty, which no longer fits the modal an LMS draws this in, and a native select
              stays keyboard and screen-reader friendly at any length while still working with
              no JavaScript, which the rest of this flow depends on. Grouping is `optgroup` for
              the same reason: the browser reads the heading out with the option, and nothing
              here has to run for it to work. */}
          <Field label="Assignment" htmlFor="assignmentId">
            <select
              id="assignmentId"
              name="assignmentId"
              required
              defaultValue={assignments[0]?.id ?? unconfirmed[0]?.id}
              className="border-input bg-card h-9 w-full rounded-md border px-3 text-sm"
            >
              {/* No headings at all in the ordinary case, where every assignment is one nobody
                  has added yet and a heading would only say so. */}
              {unconfirmed.length === 0 ? (
                assignments.map((assignment) => (
                  <AssignmentOption key={assignment.id} assignment={assignment} />
                ))
              ) : (
                <>
                  {assignments.length > 0 ? (
                    <optgroup label="Not in this LMS course">
                      {assignments.map((assignment) => (
                        <AssignmentOption key={assignment.id} assignment={assignment} />
                      ))}
                    </optgroup>
                  ) : null}
                  <optgroup label="Added before, but never opened">
                    {unconfirmed.map((assignment) => (
                      <AssignmentOption key={assignment.id} assignment={assignment} />
                    ))}
                  </optgroup>
                </>
              )}
            </select>
          </Field>

          <div className="flex items-center gap-3">
            <Submit>Use this assignment</Submit>
            <a
              href={`/lti/deep-link?pending=${pending.id}`}
              className="text-muted-foreground text-sm underline"
            >
              Back
            </a>
          </div>
        </form>
      </Shell>
    );
  }

  return (
    <Shell title="Add an AFCT assignment">
      <p className="text-muted-foreground mb-4 text-sm">
        This link will open an assignment in {link.course.name}.
      </p>
      {failure}

      <div className="space-y-3">
        <Choice
          href={`/lti/deep-link?pending=${pending.id}&mode=connect`}
          title="Use an assignment that already exists"
          detail={
            assignments.length > 0
              ? `${assignments.length} to choose from`
              : linkedCount > 0
                ? 'All of them have already been added'
                : 'There are none yet'
          }
          disabled={assignments.length === 0}
        />
        <Choice
          href={`/lti/deep-link?pending=${pending.id}&mode=create`}
          title="Create a new assignment"
          detail="Give it a title and a due date; everything else can wait"
        />
      </div>
    </Shell>
  );
}

/** What went wrong last time, when the route sent them back here to fix it. */
/**
 * One assignment in the picker's select.
 *
 * The same markup in both groups on purpose: the heading says what is different about them,
 * and an option that also said it would make the list harder to read, not easier.
 */
function AssignmentOption({
  assignment,
}: {
  assignment: { id: string; title: string; problems: { maxPoints: number | null }[] };
}) {
  const points = assignment.problems.reduce((sum, p) => sum + Number(p.maxPoints ?? 0), 0);
  return (
    <option value={assignment.id}>
      {assignment.title}, {points > 0 ? `${points} points` : 'not graded'}
    </option>
  );
}

const MESSAGES: Record<string, React.ReactNode> = {
  'already-linked': (
    <Notice>
      That assignment is already opened by a link in this LMS course, so it was not added again.
    </Notice>
  ),
  'missing-title': <Notice>Give the assignment a title and a due date.</Notice>,
  'bad-dates': <Notice>The available-from date has to be on or before the due date.</Notice>,
};

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="border-status-danger-border bg-status-danger-bg text-status-danger mb-4 rounded-md border px-3 py-2 text-sm"
    >
      {children}
    </p>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

function Submit({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="submit"
      className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center rounded-md px-4 text-sm font-medium"
    >
      {children}
    </button>
  );
}

/** One of the two ways in. A link rather than a button, so the flow needs no JavaScript. */
function Choice({
  href,
  title,
  detail,
  disabled,
}: {
  href: string;
  title: string;
  detail: string;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <div className="text-muted-foreground w-full rounded-md border border-dashed p-3 text-left">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs">{detail}</p>
      </div>
    );
  }
  return (
    <a href={href} className="hover:bg-accent block w-full rounded-md border p-3 text-left">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-muted-foreground text-xs">{detail}</p>
    </a>
  );
}

/**
 * The frame around whatever this page has to say.
 *
 * This page is almost always seen inside an LMS: Canvas draws it in a modal a few hundred
 * pixels tall, with its own heading above and its own chrome around. So it is centred in
 * whatever space it is given rather than positioned as if it owned a browser window, and it
 * carries no fixed top margin, which in a short frame simply pushed the card off the bottom.
 *
 * `dvh` rather than `vh` because the unit is measured against the frame, and the card scrolls
 * inside itself rather than the frame scrolling: centred content taller than its container is
 * the classic way to make the top of a list unreachable.
 */
function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh w-full items-center justify-center p-4">
      {/* Focusable: an LMS draws this in a short modal, so the card scrolls inside itself, and
          several of its states (expired request, course not connected, not your course) have no
          tabbable content at all. Without a focus stop the text below the fold was unreachable
          by keyboard, which is the case this page is most likely to be met in. */}
      <div
        className="bg-card max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-lg border p-6"
        tabIndex={0}
      >
        <h1 className="mb-3 text-xl font-semibold">{title}</h1>
        {children}
      </div>
    </main>
  );
}
