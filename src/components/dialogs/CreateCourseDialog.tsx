'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { User } from '@prisma/client';
import { toast } from 'sonner';
import InputGroup from '@/components/ui/InputGroup';

interface CreateCourseDialogProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  onSuccess?: () => void;
}

export function CreateCourseDialog({ open, setOpen, onSuccess }: CreateCourseDialogProps) {
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    semester: '',
    credits: 3,
    startDate: '',
    endDate: '',
    isPublished: false,
    facultyIds: [] as string[],
  });

  const [facultyList, setFacultyList] = useState<User[]>([]);

  useEffect(() => {
    const fetchFaculty = async () => {
      const res = await fetch('/api/users?role=FACULTY');
      const data = await res.json();
      setFacultyList(data);
    };
    if (open) fetchFaculty();
  }, [open]);

  const resetForm = () => {
    setFormData({
      name: '',
      code: '',
      semester: '',
      credits: 3,
      startDate: '',
      endDate: '',
      isPublished: false,
      facultyIds: [],
    });
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleFacultySelect = (id: string) => {
    setFormData((prev) => {
      const alreadySelected = prev.facultyIds.includes(id);
      return {
        ...prev,
        facultyIds: alreadySelected
          ? prev.facultyIds.filter((fid) => fid !== id)
          : [...prev.facultyIds, id],
      };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...formData,
        credits: Number(formData.credits),
      }),
    });

    if (res.ok) {
      toast.success('Course created successfully');
      setOpen(false);
      resetForm();
      onSuccess?.();
    } else {
      toast.error('Failed to create course');
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        setOpen(val);
        if (!val) resetForm();
      }}
    >
      <DialogContent className="bg-card max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create New Course</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <InputGroup
            label="Course Name"
            name="name"
            value={formData.name}
            setValue={(val) => setFormData((prev) => ({ ...prev, name: val }))}
          />

          <InputGroup
            label="Course Code"
            name="code"
            value={formData.code}
            setValue={(val) => setFormData((prev) => ({ ...prev, code: val }))}
          />

          <InputGroup
            label="Semester"
            name="semester"
            value={formData.semester}
            setValue={(val) => setFormData((prev) => ({ ...prev, semester: val }))}
          />

          <InputGroup
            label="Credits"
            name="credits"
            type="number"
            value={formData.credits.toString()}
            setValue={(val) => setFormData((prev) => ({ ...prev, credits: Number(val) }))}
          />

          <InputGroup
            label="Start Date"
            name="startDate"
            type="date"
            value={formData.startDate}
            setValue={(val) => setFormData((prev) => ({ ...prev, startDate: val }))}
          />

          <InputGroup
            label="End Date"
            name="endDate"
            type="date"
            value={formData.endDate}
            setValue={(val) => setFormData((prev) => ({ ...prev, endDate: val }))}
          />

          <div className="flex items-center justify-between">
            <Label htmlFor="isPublished">Publish Now</Label>
            <Switch
              id="isPublished"
              checked={formData.isPublished}
              onCheckedChange={(checked) =>
                setFormData((prev) => ({ ...prev, isPublished: !!checked }))
              }
            />
          </div>

          <div>
            <Label>Assign Faculty</Label>
            <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded border p-2">
              {facultyList.map((faculty) => (
                <label key={faculty.id} className="flex items-center space-x-2 text-sm">
                  <input
                    type="checkbox"
                    checked={formData.facultyIds.includes(faculty.id)}
                    onChange={() => handleFacultySelect(faculty.id)}
                  />
                  <span>
                    {faculty.firstName} {faculty.lastName}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button type="submit">Create Course</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
