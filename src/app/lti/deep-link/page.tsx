import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canManageCourse } from '@/lib/permissions';

export const metadata: Metadata = {
  title: 'Choose an assignment',
};

/**
 * Choosing which AFCT assignment an LMS link should open.
 *
 * A plain form that posts to AFCT, which answers with the page that returns to the LMS. No
 * client JavaScript: the whole flow is two POSTs, and it works if a script is blocked.
 *
 * Read here rather than fetched so the list is right on first paint and can never include an
 * assignment from a course this person does not run.
 */
export default async function DeepLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ pending?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const { pending: pendingId } = await searchParams;

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
        select: { courseId: true, course: { select: { name: true } } },
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

  const assignments = await prisma.assignment.findMany({
    where: { courseId: link.courseId },
    select: { id: true, title: true, problems: { select: { maxPoints: true } } },
    orderBy: { dueDate: 'asc' },
  });

  if (assignments.length === 0) {
    return (
      <Shell title="No assignments yet">
        <p className="text-muted-foreground text-sm">
          {link.course.name} has no assignments to link. Create one in AFCT first.
        </p>
      </Shell>
    );
  }

  return (
    <Shell title="Which assignment?">
      <p className="text-muted-foreground mb-4 text-sm">
        Choose the {link.course.name} assignment this link should open.
      </p>

      <form method="POST" action="/api/lti/deep-link" className="space-y-4">
        <input type="hidden" name="pendingId" value={pending.id} />

        <fieldset className="space-y-2">
          <legend className="sr-only">Assignments in {link.course.name}</legend>
          {assignments.map((assignment, index) => {
            const points = assignment.problems.reduce(
              (sum, p) => sum + Number(p.maxPoints ?? 0),
              0,
            );
            return (
              <label
                key={assignment.id}
                className="hover:bg-muted flex cursor-pointer items-start gap-3 rounded-md border p-3"
              >
                <input
                  type="radio"
                  name="assignmentId"
                  value={assignment.id}
                  defaultChecked={index === 0}
                  className="mt-1"
                  required
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{assignment.title}</span>
                  <span className="text-muted-foreground block text-xs">
                    {points > 0 ? `${points} points` : 'Not graded'}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>

        <button
          type="submit"
          className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center rounded-md px-4 text-sm font-medium"
        >
          Add to your LMS
        </button>
      </form>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen w-full items-start justify-center p-6">
      <div className="bg-card mt-12 w-full max-w-lg rounded-lg border p-6">
        <h1 className="mb-3 text-xl font-semibold">{title}</h1>
        {children}
      </div>
    </main>
  );
}
