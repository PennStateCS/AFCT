'use client';

import type { Course } from '@prisma/client';

import { SettingsAsideCard } from '@/components/settings/settings-layout';
import SwitchField from '@/components/ui/SwitchField';

type CourseStatusCardProps = {
  course: Pick<Course, 'id' | 'isPublished' | 'isArchived'>;
  onPublishToggle: (checked: boolean) => void;
  className?: string;
};

/**
 * The course's live publish switch, in the Settings tab's rail.
 *
 * Unlike the form's fields it applies immediately (through the page's confirmation dialog)
 * rather than on Save, which is why it is not in the form at all: a control that has
 * already taken effect sitting above a Save button invites the reading that Save is what
 * commits it. The rail is where System Settings puts the same kind of thing, so it is the
 * same card there and here. Archiving and restoring are admin-only and live on the course
 * list's Manage menu, not here.
 */
export function CourseStatusCard({ course, onPublishToggle, className }: CourseStatusCardProps) {
  return (
    // h3, because the tab contributes the "Course Settings" h2 above this.
    <SettingsAsideCard title="Course Status" className={className} headingLevel={3}>
      <div className="space-y-3">
        <p className="text-muted-foreground text-xs leading-4.5">
          This applies immediately after you confirm, not when you save.
        </p>

        <SwitchField
          label="Published"
          name="isPublished-toggle"
          checked={!!course.isPublished}
          onCheckedChange={onPublishToggle}
          description="When on, enrolled students can see the course."
          disabled={course.isArchived}
        />
      </div>
    </SettingsAsideCard>
  );
}
