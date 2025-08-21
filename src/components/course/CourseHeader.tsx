import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Pencil, Copy } from 'lucide-react';
import { FullCourse } from '@/types/course';

interface CourseHeaderProps {
  course: FullCourse;
  isStudent: boolean;
  onEditClick: () => void;
  onDuplicate?: () => void;
  onPublishToggle: (checked: boolean) => void;
}

export function CourseHeader({ course, isStudent, onEditClick, onDuplicate, onPublishToggle }: CourseHeaderProps) {
  // ...existing code...
  return (
    <Card>
      <CardHeader className="flex items-start justify-between">
        <div>
          <CardTitle className="text-2xl">
            {course.code}: {course.name}
          </CardTitle>
          <p className="text-muted-foreground mt-1 text-sm">
            {course.semester} • {course.credits} credits •{' '}
            {new Date(course.startDate).toLocaleDateString()} -{' '}
            {new Date(course.endDate).toLocaleDateString()}
          </p>
        </div>
        {!isStudent && (
          <div className="flex gap-2">
            <Button variant="default" onClick={onEditClick} className="shrink-0">
              <Pencil /> Edit Course
            </Button>
            {onDuplicate && (
              <Button variant="default" onClick={onDuplicate} className="shrink-0">
                <Copy className="mr-2" />
                Duplicate Course
              </Button>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {!isStudent && (
          <div className="flex items-center gap-2">
            <span className="font-semibold">Published:</span>
            <Switch
              checked={course.isPublished}
              onCheckedChange={onPublishToggle}
            />
          </div>
        )}
        {!isStudent && (
          <div>
            <span className="font-semibold">Registration Code: </span>
            <span className="text-muted-foreground">
              {course.regCode
                ? `${course.regCode.toUpperCase().slice(0, 3)}-${course.regCode.toUpperCase().slice(3)}`
                : 'Not set'}
            </span>
          </div>
        )}
        <div>
          <span className="font-semibold">Faculty: </span>
          <span className="text-muted-foreground">
            {course.faculty.length > 0
              ? course.faculty
                  .map((f) => `${f.firstName ?? ''} ${f.lastName ?? ''}`.trim())
                  .join(', ')
              : 'None assigned'}
          </span>
        </div>
        <div>
          <span className="font-semibold">Teaching Assistants: </span>
          <span className="text-muted-foreground">
            {course.tas.length > 0
              ? course.tas
                  .map((ta) => `${ta.firstName ?? ''} ${ta.lastName ?? ''}`.trim())
                  .join(', ')
              : 'None assigned'}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
