'use client';

import { BarChart3 } from 'lucide-react';

// Placeholder for the assignment statistics view. Staff-only: this panel is only
// rendered inside PrivilegeAssignmentView, which the server renders exclusively for
// admins and the course's FACULTY/TA. The real charts (submission counts, score
// distribution, per-problem pass rates) land in a follow-up.
export function AssignmentStatisticsPanel() {
  return (
    <div className="space-y-4">
      <h2
        role="heading"
        aria-level={2}
        className="flex items-center gap-2 text-2xl font-semibold"
      >
        <BarChart3 className="h-6 w-6" />
        Statistics
      </h2>
      <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-16 text-center">
        <BarChart3 className="h-10 w-10 opacity-40" aria-hidden="true" />
        <p className="text-base font-medium">Statistics are coming soon</p>
        <p className="max-w-md text-sm text-balance">
          This tab will summarize how the class is doing on this assignment: submission
          counts, score distribution, and per-problem pass rates.
        </p>
      </div>
    </div>
  );
}
