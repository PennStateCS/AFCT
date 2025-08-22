"use client";

import { Download, Package } from "lucide-react";
import { useState } from 'react';
import JflapFlowViewer from "./JffViewerDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { Badge } from "./ui/badge";

type Problem = {
  id: string;
  title: string;
  description?: string;
  type?: string;
  maxStates?: number;
  isDeterministic?: boolean;
  fileName?: string;
  originalFileName?: string;
};

type Props = {
  problem: Problem;
  submissionCount: number;
  className?: string;
};

const getProblemTypeBadgeProps = (type: string | null) => {
  if (!type) return null;
  const badgeMap: Record<
    string,
    { label: string; className: string; borderColor: string }
  > = {
    PDA: {
      label: "Pushdown Automaton",
      className: "bg-purple-100 text-purple-800 border-purple-200",
      borderColor: "border-l-purple-500",
    },
    RE: {
      label: "Regular Expression",
      className: "bg-blue-100 text-blue-800 border-blue-200",
      borderColor: "border-l-blue-500",
    },
    CFG: {
      label: "Context-Free Grammar",
      className: "bg-green-100 text-green-800 border-green-200",
      borderColor: "border-l-green-500",
    },
    FA: {
      label: "Finite Automaton",
      className: "bg-orange-100 text-orange-800 border-orange-200",
      borderColor: "border-l-orange-500",
    },
  };
  return (
    badgeMap[type] || {
      label: type ?? "Unknown",
      className: "bg-gray-100 text-gray-800 border-gray-200",
      borderColor: "border-l-gray-500",
    }
  );
};

export default function ProblemDetails({
  problem,
  submissionCount,
  className = "",
}: Props) {
  const typeProps = getProblemTypeBadgeProps(problem.type ?? null);
  const [open, setOpen] = useState(false);
  console.log(problem);
  return (
    <div className={`rounded-md border overflow-hidden ${className}`}>
      <header className="flex items-center gap-2 border-b bg-primary px-3 py-2 text-white rounded-t-md">
        <Package className="h-4 w-4" />
        <h4 className="text-sm font-medium text-white">Problem Details</h4>
      </header>
      <div className="bg-gray-50 p-3">
        <div className="grid gap-y-2 gap-x-6 sm:grid-cols-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">Type:</span>
            <Badge
              variant="outline"
              className={typeProps?.className || "bg-gray-100 text-gray-800"}
            >
              {typeProps?.label || problem.type || "Unknown"}
            </Badge>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">Submissions:</span>
            <span className="font-medium">{submissionCount}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">Max States:</span>
            <span className="font-medium">
              {problem.maxStates === undefined
                ? "N/A"
                : problem.maxStates === -1
                ? "Unlimited"
                : problem.maxStates}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">Deterministic:</span>
            <span className="font-medium">
              {problem.isDeterministic === undefined
                ? "N/A"
                : problem.isDeterministic
                ? "Yes"
                : "No"}
            </span>
          </div>
          <div className="col-span-full flex items-center justify-between text-sm">
            <span className="text-gray-600">Answer File:</span>

            {problem.fileName && problem.originalFileName ? (
              <div className="flex items-center gap-2">
                <a
                  href={`/uploads/problems/${problem.fileName}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-blue-600 hover:text-blue-700 underline"
                >
                  <Download className="h-3 w-3" />
                  {problem.originalFileName}
                </a>
                {/* View in dialog using the JflapFlowViewer component */}
                <div>
                  <button
                    type="button"
                    className="text-sm text-blue-600 underline"
                    onClick={() => setOpen(true)}
                  >
                    View
                  </button>
                  <Dialog open={open} onOpenChange={(v) => setOpen(v)}>
                    <DialogContent className="w-[95vw] max-w-6xl">
                      <DialogHeader>
                        <DialogTitle>View JFLAP File: {problem.originalFileName || problem.fileName}</DialogTitle>
                      </DialogHeader>
                      <div className="mt-2">
                        <JflapFlowViewer
                          src={`/uploads/problems/${encodeURIComponent(problem.fileName ?? '')}`}
                          title={problem.originalFileName ?? problem.fileName}
                          height="60vh"
                        />
                      </div>
                      <div className="mt-3 flex justify-end">
                        <DialogClose asChild>
                          <button className="btn">Close</button>
                        </DialogClose>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            ) : (
              <span className="text-gray-500 text-sm">No answer file</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
