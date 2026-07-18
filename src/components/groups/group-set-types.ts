// Client-side mirrors of the group-set API DTOs (see src/lib/group-set-service.ts).

export type EligibleStudent = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
};

export type GroupMember = EligibleStudent & { inactive: boolean };

export type Group = {
  id: string;
  name: string;
  members: GroupMember[];
};

export type GroupSetSummary = {
  id: string;
  name: string;
  locked: boolean;
  groupCount: number;
  assignedCount: number;
};

export type GroupSetDetail = {
  id: string;
  name: string;
  locked: boolean;
  groups: Group[];
  eligibleStudents: EligibleStudent[];
  basis: string;
};

export type MembershipOperation = { userId: string; groupId: string | null };

export type RandomAssignPreview = {
  groups: Group[];
  operations: { userId: string; groupId: string }[];
  basis: string;
  skippedInactive: string[];
  placedCount: number;
};

/** Human-friendly student name with sensible fallbacks. */
export function studentName(s: { firstName: string | null; lastName: string | null; email: string }): string {
  const full = `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim();
  return full || s.email || 'Student';
}
