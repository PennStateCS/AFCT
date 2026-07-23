'use client';

import { Fingerprint } from 'lucide-react';

// Placeholder for the similarity (academic-integrity) view. Staff-only: this panel is
// only rendered inside PrivilegeAssignmentView, which the server renders exclusively
// for admins and the course's FACULTY/TA. The real analysis (pairwise submission
// comparison and flagged pairs) lands in a follow-up.
export function AssignmentSimilarityPanel() {
  return (
    <div className="space-y-4">
      <h2
        role="heading"
        aria-level={2}
        className="flex items-center gap-2 text-2xl font-semibold"
      >
        <Fingerprint className="h-6 w-6" />
        Similarity
      </h2>
      <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-16 text-center">
        <Fingerprint className="h-10 w-10 opacity-40" aria-hidden="true" />
        <p className="text-base font-medium">Similarity analysis is coming soon</p>
        <p className="max-w-md text-sm text-balance">
          This tab will compare student submissions against each other and surface pairs
          that look unusually alike, to help review for possible plagiarism.
        </p>
      </div>
    </div>
  );
}
