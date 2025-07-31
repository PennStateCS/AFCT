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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useState, useEffect } from 'react';
import InputGroup from '@/components/ui/InputGroup';

type CreateAssignmentDialogProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
  courseId: string;
  onCreate?: (assignment: any) => void;
};

function getDefaultDateTime() {
  const now = new Date();
  now.setHours(23, 59, 0, 0); // Today at 11:59 PM

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function CreateAssignmentDialog({
  open,
  setOpen,
  courseId,
  onCreate,
}: CreateAssignmentDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState(getDefaultDateTime());
  const [maxPoints, setMaxPoints] = useState('');
  const [isPublished, setIsPublished] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ✅ Reset all fields when dialog opens
  useEffect(() => {
    if (open) {
      setTitle('');
      setDescription('');
      setDueDate(getDefaultDateTime()); // Today @ 11:59pm
      setMaxPoints('');
      setIsPublished(false);
      setError(null);
    }
  }, [open]);

  const handleSubmit = async () => {
    if (!title.trim() || !courseId) return;
    setLoading(true);
    setError(null);

    try {
      const payload = {
        title: title.trim(),
        description: description.trim(),
        dueDate: new Date(dueDate).toISOString(),
        maxPoints: Number(maxPoints) || 0,
        isPublished,
        courseId,
      };

      const res = await fetch('/api/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create assignment');
      }

      const newAssignment = await res.json();
      onCreate?.(newAssignment);
      setOpen(false);
    } catch (err: any) {
      setError(err.message || 'Failed to create assignment.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Assignment</DialogTitle>
          <DialogDescription>Fill in the assignment details and click Create.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <InputGroup label="Title" value={title} setValue={setTitle} />

          <div>
            <Label className="mb-2 block">Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter assignment description"
              className="min-h-[100px]"
            />
          </div>

          <InputGroup
            label="Due Date & Time"
            value={dueDate}
            setValue={setDueDate}
            type="datetime-local"
          />

          <InputGroup label="Max Points" value={maxPoints} setValue={setMaxPoints} type="number" />

          <div className="flex items-center gap-2">
            <Label className="mb-0">Published:</Label>
            <Switch checked={isPublished} onCheckedChange={setIsPublished} />
          </div>

          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>

        <DialogFooter className="mt-4">
          <DialogClose asChild>
            <Button type="button" variant="secondary" disabled={loading}>
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={handleSubmit} disabled={!title.trim() || loading}>
            {loading ? 'Creating...' : 'Create Assignment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
