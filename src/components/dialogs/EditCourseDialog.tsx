'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Course } from '@prisma/client';
import { useState } from 'react';

type EditCourseDialogProps = {
  course: Course;
  open: boolean;
  setOpen: (open: boolean) => void;
  onSave?: (updatedCourse: Partial<Course>) => void;
};

function toDateTimeLocalString(date: Date | string): string {
  const d = new Date(date);
  const offset = d.getTimezoneOffset();
  const localDate = new Date(d.getTime() - offset * 60000);
  return localDate.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
}

export function EditCourseDialog({ course, open, setOpen, onSave }: EditCourseDialogProps) {
  const [name, setName] = useState(course.name);
  const [code, setCode] = useState(course.code);
  const [semester, setSemester] = useState(course.semester);
  const [credits, setCredits] = useState(course.credits);
  const [startDate, setStartDate] = useState(toDateTimeLocalString(course.startDate));
  const [endDate, setEndDate] = useState(toDateTimeLocalString(course.endDate));

  const handleSubmit = () => {
    const updatedCourse = {
      ...course,
      name,
      code,
      semester,
      credits,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
    };
    if (onSave) onSave(updatedCourse);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Course</DialogTitle>
          <DialogDescription>Update the course details and save your changes.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="mb-2 block">Course Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label className="mb-2 block">Course Code</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div>
            <Label className="mb-2 block">Semester</Label>
            <Input value={semester} onChange={(e) => setSemester(e.target.value)} />
          </div>
          <div>
            <Label className="mb-2 block">Credits</Label>
            <Input
              type="number"
              value={credits}
              onChange={(e) => setCredits(parseInt(e.target.value))}
            />
          </div>
          <div>
            <Label className="mb-2 block">Start Date & Time</Label>
            <Input
              type="datetime-local"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div>
            <Label className="mb-2 block">End Date & Time</Label>
            <Input
              type="datetime-local"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="mt-4">
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={handleSubmit}>
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
