"use client";

import { Download } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Submission } from "@prisma/client";

type Props = {
  submissions: Submission[];
  className?: string;
};

const formatDateTime = (iso: string | Date) => {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return `${d.toLocaleDateString()} at ${d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
};

export default function SubmissionsTable({
  submissions,
  className = "",
}: Props) {
  // Process submissions: sort by newest first
  const filtered = [...submissions].sort(
    (a, b) =>
      new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
  );

  if (filtered.length === 0) {
    return (
      <div className={className}>
        {submissions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No submissions yet.</p>
        ) : (
          <p className="text-sm text-muted-foreground">No submissions found.</p>
        )}
      </div>
    );
  }

  return (
    <div className={`rounded-md border overflow-hidden bg-card ${className}`}>
      <Table>
        <TableHeader>
          <TableRow className="bg-primary">
            <TableHead className="text-white text-sm font-medium">Submitted At</TableHead>
            <TableHead className="text-white text-sm font-medium">File</TableHead>
            <TableHead className="text-white text-sm font-medium">Correct</TableHead>
            <TableHead className="text-white text-sm font-medium">Feedback</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="bg-gray-50">
          {filtered.map((submission) => (
            <TableRow key={submission.id}>
              <TableCell>{formatDateTime(submission.submittedAt)}</TableCell>
              <TableCell>
                {submission.originalFileName && submission.fileName ? (
                  <a
                    href={`/uploads/${submission.fileName}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 underline hover:text-blue-700"
                  >
                    <Download className="h-4 w-4" />
                    {submission.originalFileName}
                  </a>
                ) : (
                  <span className="text-muted-foreground">No file</span>
                )}
              </TableCell>
              <TableCell>
                {submission.correct !== null && submission.correct !== undefined ? (
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-medium ${
                      submission.correct
                        ? "bg-green-100 text-green-800"
                        : "bg-red-100 text-red-800"
                    }`}
                  >
                    {submission.correct ? "Correct" : "Incorrect"}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Not checked</span>
                )}
              </TableCell>
              <TableCell>
                {submission.feedback ? (
                  <span className="text-sm">{submission.feedback}</span>
                ) : (
                  <span className="text-muted-foreground">No feedback</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
