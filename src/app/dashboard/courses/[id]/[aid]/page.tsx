'use client';

import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AssociateProblemsDialog } from '@/components/dialogs/AssociateProblemsDialog';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { toast } from 'sonner';
import { EditAssignmentDialog } from '@/components/dialogs/EditAssignmentDialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import AssignmentSubmissions from '@/components/AssignmentSubmissions';

type Person = { firstName?: string; lastName?: string; id: string };
type Course = {
  name: string;
  code: string;
  faculty: Person[];
  tas: Person[];
};
type Problem = {
  id: string;
  title: string;
  description?: string;
  type?: string;
  maxStates?: number;
  isDeterministic?: boolean;
};
type Assignment = {
  id: string;
  title: string;
  description?: string;
  dueDate: string;
  maxPoints: number;
  isPublished: boolean;
  problems: Problem[];
  course: Course;
};

const problemTypeLabels: Record<string, string> = {
  FA: 'Finite Automaton',
  PDA: 'Pushdown Automaton',
  CFG: 'Context-Free Grammar',
  RE: 'Regular Expression',
};

export default function AssignmentPage() {
  const { id, aid } = useParams<{ id: string; aid: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddProblem, setShowAddProblem] = useState(false);
  const [allProblems, setAllProblems] = useState<Problem[]>([]);
  const [problemsLoading, setProblemsLoading] = useState(false);
  const [problemToRemove, setProblemToRemove] = useState<Problem | null>(null);
  const [removing, setRemoving] = useState(false);
  const [editAssignmentOpen, setEditAssignmentOpen] = useState(false);

  // tab state synced with URL param
  const [tab, setTab] = useState(searchParams.get('tab') || 'problems');
  const handleTabChange = useCallback(
    (value: string) => {
      setTab(value);
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', value);
      router.replace(`?${params.toString()}`);
    },
    [searchParams, router],
  );

  // Fetch all problems in course (once)
  useEffect(() => {
    if (!id) return;
    setProblemsLoading(true);
    fetch(`/api/courses/${id}/problems`)
      .then((res) => res.json())
      .then((data) => setAllProblems(Array.isArray(data) ? data : []))
      .catch(() => setAllProblems([]))
      .finally(() => setProblemsLoading(false));
  }, [id]);

  // Fetch assignment with problems
  useEffect(() => {
    if (!aid) return;
    setLoading(true);
    fetch(`/api/courses/${id}/${aid}`)
      .then((res) => res.json())
      .then((data) => setAssignment(data))
      .catch(() => setAssignment(null))
      .finally(() => setLoading(false));
  }, [id, aid]);

  // Add handler: POST to your endpoint and refetch
  async function handleAddProblems(problemIds: string[]) {
    if (!id || !aid) return;
    try {
      const res = await fetch(`/api/courses/${id}/${aid}/add-problems`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problemIds }),
      });
      if (!res.ok) throw new Error();
      toast.success('Problems added');
    } catch {
      toast.error('Failed to add problems');
    }
    setLoading(true);
    fetch(`/api/courses/${id}/${aid}`)
      .then((res) => res.json())
      .then((data) => setAssignment(data))
      .finally(() => setLoading(false));
  }

  async function handleConfirmRemoveProblem() {
    if (!id || !aid || !problemToRemove) return;
    setRemoving(true);
    try {
      const res = await fetch(`/api/courses/${id}/${aid}/remove-problem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problemId: problemToRemove.id }),
      });
      if (!res.ok) throw new Error();
      toast.success(`"${problemToRemove.title}" removed from assignment`);
    } catch {
      toast.error(`Failed to remove "${problemToRemove.title}"`);
    }
    setLoading(true);
    fetch(`/api/courses/${id}/${aid}`)
      .then((res) => res.json())
      .then((data) => setAssignment(data))
      .finally(() => {
        setRemoving(false);
        setProblemToRemove(null);
        setLoading(false);
      });
  }

  const handleEditAssignment = () => setEditAssignmentOpen(true);
  const handleEditProblem = (problem: Problem) => alert(`Edit problem "${problem.title}" modal!`);

  if (loading) return <div className="p-6">Loading assignment...</div>;
  if (!assignment) return <div className="p-6 text-red-500">Assignment not found.</div>;

  const renderNames = (people: Person[]) =>
    people.length
      ? people.map((p) => `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim()).join(', ')
      : 'None';

  return (
    <div className="mx-auto w-full">
      {/* Assignment details */}
      <div className="bg-card relative mb-8 w-full rounded-lg border p-6 shadow">
        <h1 className="text-2xl font-bold">{assignment.title}</h1>
        <p className="text-muted-foreground mt-2">{assignment.description || 'No description.'}</p>
        <div className="mt-4 flex flex-wrap gap-8 text-sm">
          <div>
            <span className="font-semibold">Course:</span> {assignment.course?.name}{' '}
            {assignment.course?.code && `(${assignment.course.code})`}
          </div>
          <div>
            <span className="font-semibold">Faculty:</span>{' '}
            <span className="text-muted-foreground">
              {renderNames(assignment.course?.faculty ?? [])}
            </span>
          </div>
          <div>
            <span className="font-semibold">TAs:</span>{' '}
            <span className="text-muted-foreground">
              {renderNames(assignment.course?.tas ?? [])}
            </span>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-6 text-sm">
          <span>
            <strong>Due:</strong> {new Date(assignment.dueDate).toLocaleString()}
          </span>
          <span>
            <strong>Max Points:</strong> {assignment.maxPoints}
          </span>
          <span>
            <strong>Status:</strong>{' '}
            {assignment.isPublished ? (
              <span className="font-semibold text-green-600">Published</span>
            ) : (
              <span className="font-semibold text-yellow-500">Unpublished</span>
            )}
          </span>
        </div>
        <div className="flex gap-2 p-4">
          <Button variant="default" aria-label="Edit Assignment" onClick={handleEditAssignment}>
            Edit Assignment
          </Button>
          <Button
            variant="default"
            aria-label="Add Existing Problem"
            onClick={() => setShowAddProblem(true)}
            disabled={problemsLoading}
          >
            Add Existing Problem
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList className="bg-card border-border h-12 rounded-md border p-1 shadow-sm">
          <TabsTrigger
            className="data-[state=active]:bg-secondary w-50 data-[state=active]:text-white"
            value="problems"
          >
            🎓 Problems
          </TabsTrigger>
          <TabsTrigger
            className="data-[state=active]:bg-secondary w-50 data-[state=active]:text-white"
            value="submissions"
          >
            📈 Submissions
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="problems"
          className="animate-fade-in-up transition-opacity duration-300"
        >
          <Card className="w-full">
            <CardHeader>
              <CardTitle>Problems</CardTitle>
            </CardHeader>

            <CardContent>
              {!Array.isArray(assignment.problems) ? (
                <p className="text-muted-foreground italic">Loading problems...</p>
              ) : assignment.problems.length === 0 ? (
                <p className="text-muted-foreground italic">
                  No problems associated with this assignment.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {assignment.problems.map((problem, idx) => (
                    <div
                      key={problem.id}
                      className="dark:bg-muted relative w-full rounded border bg-white p-4 shadow-sm"
                    >
                      <div className="absolute top-4 right-4 flex gap-2">
                        <Button
                          variant="default"
                          aria-label={`Edit Problem ${problem.title}`}
                          onClick={() => handleEditProblem(problem)}
                        >
                          Edit Problem
                        </Button>
                        <Button
                          variant="destructive"
                          aria-label={`Remove Problem ${problem.title}`}
                          onClick={() => setProblemToRemove(problem)}
                        >
                          Remove
                        </Button>
                      </div>
                      <div className="flex items-start gap-4">
                        <div className="flex min-w-[2.5rem] flex-col items-center pt-1">
                          <span
                            className="bg-secondary flex h-8 w-8 items-center justify-center rounded-full text-base font-semibold text-white"
                            style={{ minWidth: '2rem', minHeight: '2rem' }}
                          >
                            {idx + 1}
                          </span>
                        </div>
                        <div className="flex-1">
                          <h3 className="text-lg font-bold">{problem.title}</h3>
                          {problem.description && (
                            <p className="text-muted-foreground mt-1 text-sm">
                              {problem.description}
                            </p>
                          )}
                          <div className="mt-2 flex flex-wrap gap-4 text-xs">
                            {problem.type && (
                              <span>
                                <strong>Type:</strong>{' '}
                                {problemTypeLabels[problem.type ?? ''] || problem.type || 'Unknown'}
                              </span>
                            )}
                            {problem.maxStates !== undefined && (
                              <span>
                                <strong>Max States:</strong>{' '}
                                {problem.maxStates === -1 ? 'Unlimited' : problem.maxStates}
                              </span>
                            )}
                            {typeof problem.isDeterministic === 'boolean' && (
                              <span>
                                <strong>Deterministic:</strong>{' '}
                                {problem.isDeterministic ? 'Yes' : 'No'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent
          value="submissions"
          className="animate-fade-in-up transition-opacity duration-300"
        >
          <Card className="w-full">
            <CardContent>
              <AssignmentSubmissions
                courseId={id}
                assignmentId={aid}
                problems={assignment.problems}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* --- MODAL --- */}
      <AssociateProblemsDialog
        open={showAddProblem}
        onClose={() => setShowAddProblem(false)}
        allProblems={allProblems}
        usedProblems={assignment.problems}
        onAddProblems={handleAddProblems}
        problemTypeLabels={problemTypeLabels}
      />

      <ConfirmDialog
        open={!!problemToRemove}
        title="Remove Problem"
        description={
          problemToRemove
            ? `Are you sure you want to remove "${problemToRemove.title}" from this assignment?`
            : undefined
        }
        confirmText="Remove"
        cancelText="Cancel"
        onConfirm={handleConfirmRemoveProblem}
        onCancel={() => setProblemToRemove(null)}
      />
      {assignment && (
        <EditAssignmentDialog
          assignment={assignment}
          open={editAssignmentOpen}
          setOpen={setEditAssignmentOpen}
          onSave={(updated) => {
            setAssignment(updated); // Update local assignment state
            toast.success('Assignment updated!');
          }}
        />
      )}
    </div>
  );
}
