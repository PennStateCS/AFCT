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
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Assignment } from '@prisma/client';
import { useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import InputGroup from '@/components/ui/InputGroup';

// Convert date to local YYYY-MM-DDTHH:MM string
function toDateTimeLocalString(date: Date | string): string {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

type EditAssignmentDialogProps = {
  assignment: Assignment;
  open: boolean;
  setOpen: (open: boolean) => void;
  onSave?: (updatedAssignment: Assignment) => void;
};

export function EditAssignmentDialog({
  assignment,
  open,
  setOpen,
  onSave,
}: EditAssignmentDialogProps) {
  const [title, setTitle] = useState(assignment.title);
  const [description, setDescription] = useState(assignment.description ?? '');
  const [dueDate, setDueDate] = useState(toDateTimeLocalString(assignment.dueDate));
  const [maxPoints, setMaxPoints] = useState(assignment.maxPoints.toString());
  const [isPublished, setIsPublished] = useState(assignment.isPublished);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const payload = {
        title,
        description,
        dueDate: new Date(dueDate),
        maxPoints: Number(maxPoints),
        isPublished,
      };

      const res = await fetch(`/api/assignments/${assignment.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error('Failed to update assignment');

      const updatedAssignment = await res.json();
      if (onSave) onSave(updatedAssignment);
      setOpen(false);
    } catch (err) {
      alert('Failed to update assignment.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-card">
        <DialogHeader>
          <DialogTitle>Edit Assignment</DialogTitle>
          <DialogDescription>
            Update the assignment details and save your changes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Title with InputGroup */}
          <InputGroup label="Title" value={title} setValue={setTitle} />

          {/* Description with Textarea */}
          <div>
            <Label className="mb-2 block">Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter assignment description"
              className="min-h-[100px]"
            />
          </div>

          {/* Due Date with InputGroup */}
          <InputGroup
            label="Due Date & Time"
            value={dueDate}
            setValue={setDueDate}
            type="datetime-local"
          />

          {/* Max Points with InputGroup */}
          <InputGroup label="Max Points" value={maxPoints} setValue={setMaxPoints} type="number" />

          <div className="flex items-center gap-2">
            <Label className="mb-0">Published:</Label>
            <Switch checked={isPublished} onCheckedChange={setIsPublished} />
          </div>
        </div>

        <DialogFooter className="mt-4">
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
