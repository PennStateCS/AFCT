'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { User } from '@prisma/client';

export default function CreateCoursePage() {
  const router = useRouter();

  const [formData, setFormData] = useState({
    name: '',
    code: '',
    semester: '',
    credits: 3,
    startDate: '',
    endDate: '',
    isPublished: false,
    facultyIds: [] as string[],
	instructorIds: [] as string[],
  });

  const [facultyList, setFacultyList] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const fetchFaculty = async () => {
      try {
        const res = await fetch('/api/users?role=FACULTY');
        const data = await res.json();
        setFacultyList(data);
      } catch (err) {
        console.error('Failed to fetch faculty:', err);
      }
    };
    fetchFaculty();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === 'credits' ? Number(value) : type === 'checkbox' ? checked : value,
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

  const handleFacultySelect = (id: string) => {
    setFormData((prev) => {
      const alreadySelected = prev.instructorIds.includes(id);
      return {
        ...prev,
        facultyIds: alreadySelected
          ? prev.instructorIds.filter((fid) => fid !== id)
          : [...prev.instructorIds, id],
      };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || 'Failed to create course');
      }

      router.push('/dashboard/courses');
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create course';
      setErrorMsg(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="mx-auto mt-6 max-w-2xl">
      <CardHeader>
        <CardTitle>Create New Course</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="name">Course Name</Label>
            <Input id="name" name="name" value={formData.name} onChange={handleChange} required />
          </div>

          <div>
            <Label htmlFor="code">Course Code</Label>
            <Input id="code" name="code" value={formData.code} onChange={handleChange} required />
          </div>

          <div>
            <Label htmlFor="semester">Semester</Label>
            <Input
              id="semester"
              name="semester"
              value={formData.semester}
              onChange={handleChange}
              required
            />
          </div>

          <div>
            <Label htmlFor="credits">Credits</Label>
            <Input
              id="credits"
              name="credits"
              type="number"
              min={1}
              max={6}
              value={formData.credits}
              onChange={handleChange}
              required
            />
          </div>

          <div>
            <Label htmlFor="startDate">Start Date</Label>
            <Input
              id="startDate"
              name="startDate"
              type="date"
              value={formData.startDate}
              onChange={handleChange}
              required
            />
          </div>

          <div>
            <Label htmlFor="endDate">End Date</Label>
            <Input
              id="endDate"
              name="endDate"
              type="date"
              value={formData.endDate}
              onChange={handleChange}
              required
            />
          </div>

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
              {facultyList.length === 0 ? (
                <p className="text-muted-foreground text-sm">No faculty available.</p>
              ) : (
                facultyList.map((faculty) => (
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
                ))
              )}
            </div>
          </div>

          <div>
            <Label>Assign Instructors</Label>
            <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded border p-2">
              {facultyList.length === 0 ? (
                <p className="text-muted-foreground text-sm">No faculty available.</p>
              ) : (
                facultyList.map((faculty) => (
                  <label key={faculty.id} className="flex items-center space-x-2 text-sm">
                    <input
                      type="checkbox"
                      checked={formData.instructorIds.includes(faculty.id)}
                      onChange={() => handleInstructorSelect(faculty.id)}
                    />
                    <span>
                      {faculty.firstName} {faculty.lastName}
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>

          {errorMsg && <p className="text-sm text-red-500">{errorMsg}</p>}

          <Button type="submit" disabled={loading}>
            {loading ? 'Creating...' : 'Create Course'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
