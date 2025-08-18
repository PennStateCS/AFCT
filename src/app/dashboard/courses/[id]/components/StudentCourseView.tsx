import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FullCourse } from '../types';

interface StudentCourseViewProps {
  course: FullCourse;
}

export function StudentCourseView({ course }: StudentCourseViewProps) {
  const router = useRouter();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">📄 Assignments</CardTitle>
      </CardHeader>
      <CardContent>
        {course.assignments.length === 0 ? (
          <p className="text-muted-foreground">No assignments available yet.</p>
        ) : (
          <>
            <p className="text-muted-foreground mb-4">
              Click on any assignment below to view details and work on problems.
            </p>
            <div className="space-y-4">
              {course.assignments
                .filter((assignment) => assignment.isPublished)
                .map((assignment) => {
                  const isOverdue = new Date(assignment.dueDate) < new Date();
                  
                  return (
                    <div 
                      key={assignment.id} 
                      className="group border-border bg-card flex h-full cursor-pointer overflow-hidden rounded-lg border shadow transition-all hover:bg-gray-50 hover:shadow-md"
                      onClick={() => router.push(`/dashboard/assignments/${assignment.id}`)}
                    >
                      {/* Vertical colored bar - blue for assignments */}
                      <div className="w-[15px] bg-primary" />

                      {/* Content area */}
                      <div className="flex w-full flex-col px-4 py-4 sm:p-5">
                        {/* Title */}
                        <div className="mb-2">
                          <div className="text-md font-semibold">
                            {assignment.title}
                          </div>
                          {assignment.description && (
                            <div className="text-muted-foreground mt-1 text-sm">
                              {assignment.description}
                            </div>
                          )}
                        </div>

                        {/* Due Date and Metadata Row */}
                        <div className="flex flex-wrap items-center gap-4">
                          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${
                            isOverdue
                              ? 'bg-red-100 border border-red-200' 
                              : 'bg-green-100 border border-green-200'
                          }`}>
                            <span className={`text-sm ${
                              isOverdue
                                ? 'text-red-700' 
                                : 'text-green-700'
                            }`}>⏰</span>
                            <span className={`text-sm font-medium ${
                              isOverdue
                                ? 'text-red-700' 
                                : 'text-green-700'
                            }`}>
                              {isOverdue ? 'OVERDUE: ' : 'Due: '}
                              {new Date(assignment.dueDate).toLocaleDateString()} at{' '}
                              {new Date(assignment.dueDate).toLocaleTimeString([], { 
                                hour: '2-digit', 
                                minute: '2-digit' 
                              })}
                            </span>
                          </div>
                          
                          <div className="flex items-center gap-4 text-sm">
                            <div>
                              <span className="font-semibold">Problems:</span> {assignment.problemCount}
                            </div>
                            <div>
                              <span className="font-semibold">Points:</span> {assignment.maxPoints}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
