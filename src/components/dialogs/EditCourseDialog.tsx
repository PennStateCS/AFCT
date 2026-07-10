'use client';

import React from 'react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { Course } from '@prisma/client';
import type { EnrolledUser } from '@/lib/course-utils';
import { CourseSettingsForm } from '@/components/course/CourseSettingsForm';

type EditCourseDialogProps = {
  course: Course & { enrolled?: EnrolledUser[] };
  open: boolean;
  setOpen: (open: boolean) => void;
  onSave?: (updatedCourse: Partial<Course>) => void;
  // Kept for API compatibility with callers; the form anchors dates to the
  // course's own timezone, so this is no longer used.
  timeZone: string;
};

export function EditCourseDialog({ course, open, setOpen, onSave }: EditCourseDialogProps) {
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-card max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Course</DialogTitle>
          <DialogDescription>Update the course details and save your changes.</DialogDescription>
        </DialogHeader>

        <CourseSettingsForm
          course={course}
          onCancel={() => setOpen(false)}
          onSaved={(updated) => {
            onSave?.(updated);
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
