'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Assignment, Problem, Course } from '@prisma/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { showToast } from '@/lib/toast';
import { ArrowLeft, Clock, BookOpen, Target } from 'lucide-react';

type AssignmentProblem = {
  problem: Problem;
};

type AssignmentWithDetails = Assignment & {
  course: Course;
  problems: AssignmentProblem[];
};

export default function StudentAssignmentPage() {
  const { id } = useParams();
  const { data: session } = useSession();
  const router = useRouter();
  const [assignment, setAssignment] = useState<AssignmentWithDetails | null>(null);
  const [loading, setLoading] = useState(true);

  const isStudent = session?.user?.role === 'STUDENT';

  useEffect(() => {
    const fetchAssignment = async () => {
      try {
        const res = await fetch(`/api/assignments/${id}`);
        if (!res.ok) {
          if (res.status === 404) {
            showToast.error('Assignment not found');
            router.push('/dashboard');
            return;
          }
          throw new Error('Failed to fetch assignment');
        }
        const data = await res.json();
        setAssignment(data);
      } catch (error) {
        console.error('Error fetching assignment:', error);
        showToast.error('Failed to load assignment');
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      fetchAssignment();
    }
  }, [id, router]);

  if (loading) {
    return <div className="p-6">Loading assignment...</div>;
  }

  if (!assignment) {
    return <div className="p-6">Assignment not found.</div>;
  }

  // Check if assignment is published for students
  if (isStudent && !assignment.isPublished) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">This assignment is not yet available.</p>
            <Button 
              variant="outline" 
              onClick={() => router.push(`/dashboard/courses/${assignment.courseId}`)}
              className="mt-4"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Course
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const dueDate = new Date(assignment.dueDate);
  const isOverdue = dueDate < new Date();

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button 
          variant="outline" 
          onClick={() => router.push(`/dashboard/courses/${assignment.courseId}`)}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Course
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{assignment.title}</h1>
          <p className="text-muted-foreground">
            {assignment.course.code}: {assignment.course.name}
          </p>
        </div>
      </div>

      {/* Assignment Details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="w-5 h-5" />
            Assignment Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {assignment.description && (
            <div>
              <h3 className="font-semibold mb-2">Description</h3>
              <p className="text-muted-foreground">{assignment.description}</p>
            </div>
          )}
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="font-semibold">Due Date</p>
                <p className={`text-sm ${isOverdue ? 'text-red-600' : 'text-muted-foreground'}`}>
                  {dueDate.toLocaleDateString()} at {dueDate.toLocaleTimeString([], { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                  })}
                  {isOverdue && ' (Overdue)'}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="font-semibold">Max Points</p>
                <p className="text-sm text-muted-foreground">{assignment.maxPoints}</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="font-semibold">Problems</p>
                <p className="text-sm text-muted-foreground">{assignment.problems.length}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Problems */}
      {assignment.problems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Problems</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {assignment.problems.map((assignmentProblem, index) => (
                <div key={assignmentProblem.problem.id} className="border rounded-lg p-4">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h3 className="font-semibold">
                        Problem {index + 1}: {assignmentProblem.problem.title}
                      </h3>
                      {assignmentProblem.problem.description && (
                        <p className="text-muted-foreground mt-1">{assignmentProblem.problem.description}</p>
                      )}
                      <div className="flex gap-4 mt-2 text-sm text-muted-foreground">
                        {assignmentProblem.problem.type && <span>Type: {assignmentProblem.problem.type}</span>}
                        {assignmentProblem.problem.originalFileName && (
                          <span>File: {assignmentProblem.problem.originalFileName}</span>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        // TODO: Navigate to problem solving interface
                        showToast.info('Problem solving interface coming soon!');
                      }}
                    >
                      Work on Problem
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {assignment.problems.length === 0 && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-center">
              No problems have been added to this assignment yet.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
