import { prisma } from '@/lib/prisma';
import AssignmentBreadcrumbSource from '@/components/navbar/AssignmentBreadcrumbSource';

type Props = {
  children: React.ReactNode;
  params: Promise<{ id: string; aid: string }>;
};

export default async function AssignmentLayout({ children, params }: Props) {
  const { id, aid } = await params;
  const assignment = await prisma.assignment.findFirst({
    where: { id: aid, courseId: id },
    select: { id: true, title: true },
  });

  return (
    <>
      {assignment ? (
        <AssignmentBreadcrumbSource
          assignmentId={assignment.id}
          assignmentTitle={assignment.title}
        />
      ) : null}
      {children}
    </>
  );
}
