'use client';

import type { Course } from '@prisma/client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import SwitchField from '@/components/ui/SwitchField';

type CourseStatusCardProps = {
  course: Pick<Course, 'isPublished' | 'isArchived'>;
  onPublishToggle: (checked: boolean) => void;
  className?: string;
};

/**
 * The course's live publish switch. Unlike the settings form's fields, it applies
 * immediately (through the page's confirmation dialog) rather than on Save, so it
 * sits in its own card beside the form. Archiving and restoring are admin-only and
 * live on the course list's Manage menu, not here.
 */
export function CourseStatusCard({ course, onPublishToggle, className }: CourseStatusCardProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg">Course Status</CardTitle>
        <CardDescription>
          This applies immediately after you confirm, not when you save.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <SwitchField
          label="Published"
          name="isPublished-toggle"
          checked={!!course.isPublished}
          onCheckedChange={onPublishToggle}
          description="When on, enrolled students can see the course."
          disabled={course.isArchived}
        />
      </CardContent>
    </Card>
  );
}
