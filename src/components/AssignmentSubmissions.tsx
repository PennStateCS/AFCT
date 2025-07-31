'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Button } from './ui/button';
import { DataTable } from './ui/data-table';
import { Textarea } from './ui/textarea';

type Person = { firstName?: string; lastName?: string; id: string };

type Problem = {
  id: string;
  title: string;
  description?: string;
  type?: string;
  maxStates?: number;
  isDeterministic?: boolean;
};

type Props = {
  courseId: string;
  assignmentId: string;
  problems: Problem[];
};

type Submission = {
  content: string;
  submittedAt: string;
  grade?: string;
  fileName?: string;
  feedback?: string;
  attempt: number;
  origionalFilename?: string;
};

const problemTypeLabels: Record<string, string> = {
  FA: 'Finite Automaton',
  PDA: 'Pushdown Automaton',
  CFG: 'Context-Free Grammar',
  RE: 'Regular Expression',
};

export default function AssignmentSubmissions({ courseId, assignmentId, problems }: Props) {
  const [students, setStudents] = useState<Person[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [submissions, setSubmissions] = useState<Record<string, Submission[]>>({});

  const selectedStudent = students[selectedIndex] ?? null;

  useEffect(() => {
    fetch(`/api/courses/${courseId}/students`)
      .then((res) => res.json())
      .then((data: Person[]) => {
        setStudents(data);
        if (data.length > 0) setSelectedIndex(0);
      })
      .catch(() => setStudents([]));
  }, [courseId]);

  useEffect(() => {
    if (!selectedStudent) return;
    fetch(`/api/courses/${courseId}/${assignmentId}/submissions/${selectedStudent.id}`)
      .then((res) => res.json())
      .then((data: Record<string, Submission[]>) => setSubmissions(data))
      .catch(() => setSubmissions({}));
  }, [courseId, assignmentId, selectedStudent?.id]);

  const handleSelectChange = (id: string) => {
    const index = students.findIndex((s) => s.id === id);
    if (index !== -1) setSelectedIndex(index);
  };

  const goPrev = () => setSelectedIndex((prev) => Math.max(0, prev - 1));
  const goNext = () => setSelectedIndex((prev) => Math.min(students.length - 1, prev + 1));

  return (
    <div>
      <div className="mb-4 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={goPrev}
            disabled={selectedIndex <= 0}
            className="flex items-center gap-x-1"
          >
            <ChevronLeft className="h-4 w-4" /> Previous
          </Button>

          <select
            className="w-[220px] rounded border px-3 py-2"
            onChange={(e) => handleSelectChange(e.target.value)}
            value={selectedStudent?.id ?? ''}
          >
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.firstName} {s.lastName}
              </option>
            ))}
          </select>

          <Button
            variant="secondary"
            onClick={goNext}
            disabled={selectedIndex >= students.length - 1}
            className="flex items-center gap-x-1"
          >
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {selectedStudent && (
          <span className="text-muted-foreground text-sm">
            {selectedIndex + 1} of {students.length}
          </span>
        )}
      </div>

      {selectedStudent && (
        <div className="space-y-4">
          {problems.map((problem, index) => (
            <div key={problem.id} className="bg-background mb-15 rounded border p-4 shadow-sm">
              <div className="mb-2 flex items-start gap-4 rounded border bg-white p-4 shadow">
                <div className="mb-4 flex-1">
                  <div className="mb-4 text-lg font-bold">Problem: {problem.title}</div>

                  <div className="flex flex-wrap items-center gap-x-6 border-t-2 border-b-2 pt-2 pb-2 text-sm">
                    <div>
                      <strong>Type:&nbsp;</strong>
                      {problemTypeLabels[problem.type ?? ''] || problem.type || 'Unknown'}
                    </div>

                    {problem.maxStates !== undefined && (
                      <div>
                        <strong>Max States:&nbsp;</strong>{' '}
                        {problem.maxStates === -1 ? 'Unlimited' : problem.maxStates}
                      </div>
                    )}

                    <div>
                      <strong>Deterministic:&nbsp;</strong> {problem.isDeterministic ? 'Yes' : 'No'}
                    </div>
                  </div>
                  <div className="mt-4 mb-4 text-sm">{problem.description}</div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <div className="rounded border bg-white p-4 shadow">
                  <div className="text-md pb-4 font-semibold">Submissions</div>

                  {submissions[problem.id]?.length ? (
                    <DataTable
                      columns={[
                        {
                          accessorKey: 'attempt',
                          header: 'Attempt',
                        },
                        {
                          accessorKey: 'submittedAt',
                          header: 'Submitted At',
                          cell: ({ getValue }) => new Date(getValue<string>()).toLocaleString(),
                        },
                        {
                          accessorKey: 'feedback',
                          header: 'System Feedback',
                          cell: ({ getValue }) => getValue() || 'None',
                        },
                        {
                          accessorKey: 'originalFileName',
                          header: 'File',
                          cell: ({ row }) => {
                            const original = row.original.originalFileName;
                            const file = row.original.fileName;
                            if (original && file) {
                              return (
                                <a
                                  href={`/uploads/submissions/${file}`}
                                  download={original} // Use original filename for download name
                                  className="text-blue-600 underline hover:text-blue-800"
                                >
                                  {original}
                                </a>
                              );
                            }
                            return 'No File';
                          },
                        },
                      ]}
                      data={submissions[problem.id]}
                    />
                  ) : (
                    <div className="p-15 text-center italic">No submissions</div>
                  )}
                </div>

                <div className="rounded border bg-white p-4 shadow">
                  <div className="text-md pb-4 font-semibold">Comments</div>
                  <Textarea />
                  <Button
                    variant="default"
                    onClick={goPrev}
                    className="mt-4 flex items-center gap-x-1"
                  >
                    Save Comment
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
