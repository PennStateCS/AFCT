"use client";

import { Download, Eye, Check, X, Minus } from "lucide-react";
import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Submission } from "@prisma/client";
import JffViewerDialog from "./JffViewerDialog";

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
  const [openDialog, setOpenDialog] = useState<{
    open: boolean;
    submission: Submission | null;
  }>({ open: false, submission: null });

  // Process submissions: sort by oldest first
  const filtered = [...submissions].sort(
    (a, b) =>
      new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime()
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
            <TableHead className="text-white text-sm font-medium">Attempt</TableHead>
            <TableHead className="text-white text-sm font-medium">Submitted At</TableHead>
            <TableHead className="text-white text-sm font-medium">Correct</TableHead>
            <TableHead className="text-white text-sm font-medium">Feedback</TableHead>
            <TableHead className="text-white text-sm font-medium">File</TableHead>
            <TableHead className="text-white text-sm font-medium">View</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((submission, index) => (
            <TableRow key={submission.id}>
              <TableCell>{index + 1}</TableCell>
              <TableCell>{formatDateTime(submission.submittedAt)}</TableCell>
              <TableCell>
                {submission.correct !== null && submission.correct !== undefined ? (
                  <div className="flex justify-center">
                    {submission.correct ? (
                      <Check className="h-4 w-4 text-green-600" />
                    ) : (
                      <X className="h-4 w-4 text-red-600" />
                    )}
                  </div>
                ) : (
                  <div className="flex justify-center">
                    <Minus className="h-4 w-4 text-gray-400" />
                  </div>
                )}
              </TableCell>
              <TableCell>
                {submission.feedback ? (
                  <span className="text-sm">{submission.feedback}</span>
                ) : (
                  <span className="text-muted-foreground">No feedback</span>
                )}
              </TableCell>
              <TableCell>
                {submission.originalFileName && submission.fileName ? (
                  <a
                    href={`/uploads/submissions/${submission.fileName}`}
                    download={submission.originalFileName}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-blue-600 hover:text-blue-700 underline"
                  >
                    <Download className="h-4 w-4" />
                    {submission.originalFileName}
                  </a>
                ) : (
                  <span className="text-muted-foreground">No file</span>
                )}
              </TableCell>
              <TableCell>
                {submission.originalFileName && submission.fileName ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setOpenDialog({ open: true, submission })}
                    className="flex items-center gap-1"
                  >
                    <Eye className="h-3 w-3" />
                    View
                  </Button>
                ) : (
                  <span className="text-muted-foreground text-sm">No file</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* JffViewerDialog for viewing submitted files */}
      {openDialog.submission && (
        <JffViewerDialog
          open={openDialog.open}
          onOpenChange={(open) => setOpenDialog({ open, submission: null })}
          src={`/uploads/submissions/${encodeURIComponent(openDialog.submission.fileName ?? '')}`}
          title={`${openDialog.submission.originalFileName || openDialog.submission.fileName} - Submission`}
          width="70vw"
          height="70vh"
          honorPositions // turn on to respect <x>/<y> from .jff
          // darkMode
          // epsSymbol="ε"
          // labelWrapWidth={24}
        />
      )}
    </div>
  );
}
