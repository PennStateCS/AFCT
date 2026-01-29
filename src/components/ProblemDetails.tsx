"use client";

import { Download, Package, Eye } from "lucide-react";
import { useState } from 'react';
import JffViewerDialog from "./JffViewerDialog";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

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
      borderColor: "border-8-purple-500",
    },
    RE: {
      label: "Regular Expression",
      className: "bg-blue-100 text-blue-800 border-blue-200",
      borderColor: "border-8-blue-500",
    },
    CFG: {
      label: "Context-Free Grammar",
      className: "bg-green-100 text-green-800 border-green-200",
      borderColor: "border-8-green-500",
    },
    FA: {
      label: "Finite Automaton",
      className: "bg-orange-100 text-orange-800 border-orange-200",
      borderColor: "border-8-orange-500",
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
  // problem data available via prop
  return (
    <div className={`rounded-md border border-border overflow-hidden bg-card ${className}`}>
      <header className="flex items-center gap-2 border-b border-border bg-primary px-3 py-2 rounded-t-md">
        <Package className="h-4 w-4 text-white" />
        <h4 className="text-sm font-medium text-white">Problem Details</h4>
      </header>
      <div className="bg-card p-3">
        <div className="grid gap-y-2 gap-x-6 sm:grid-cols-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Type:</span>
            <Badge
              variant="outline"
              className={typeProps?.className || "bg-muted text-muted-foreground border-border"}
            >
              {typeProps?.label || problem.type || "Unknown"}
            </Badge>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Submissions:</span>
            <span className="font-medium">{submissionCount}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Max States:</span>
            <span className="font-medium">
              {problem.maxStates === undefined
                ? "N/A"
                : problem.maxStates === -1
                ? "Unlimited"
                : problem.maxStates}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Deterministic:</span>
            <span className="font-medium">
              {problem.isDeterministic === undefined
                ? "N/A"
                : problem.isDeterministic
                ? "Yes"
                : "No"}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Answer File:</span>

            {problem.fileName && problem.originalFileName ? (
              <div className="flex items-center gap-2">
                <a
                  href={`/api/files/problems?file=${problem.fileName}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline"
                >
                  <Download className="h-3 w-3" />
                  {problem.originalFileName}
                </a>
                {/* View in dialog using the new JffViewerDialog component */}
                <div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setOpen(true)}
                    className="flex items-center gap-1"
                  >
                    <Eye className="h-3 w-3" />
                    View
                  </Button>
                  <JffViewerDialog
                    open={open}
                    onOpenChange={setOpen}
                    src={`/api/files/problems?file=${encodeURIComponent(problem.fileName ?? '')}`}
                    title={`${problem.originalFileName || problem.fileName} - ${problem.title}`}
                    width="70vw"
                    height="70vh"
                    showGridDefault={true}
                  />
                </div>
              </div>
            ) : (
              <span className="text-muted-foreground text-sm">No answer file</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
