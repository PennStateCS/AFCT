// The ActivityLog scalar columns that may be listed and exported. Relation
// objects are intentionally excluded; only these names are accepted from the
// client, so a request can't select arbitrary Prisma fields.
export const EXPORTABLE_LOG_FIELDS = [
  'id',
  'timestamp',
  'userId',
  'action',
  'category',
  'severity',
  'ipAddress',
  'userAgent',
  'courseId',
  'assignmentId',
  'problemId',
  'submissionId',
  'metadata',
] as const;

export type ExportableLogField = (typeof EXPORTABLE_LOG_FIELDS)[number];
