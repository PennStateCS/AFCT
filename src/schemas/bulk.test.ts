import { describe, expect, it } from 'vitest';

import { BulkEnrollUserIdsSchema, BulkEnrollEmailsSchema, BulkImportUsersSchema } from './bulk';

describe('bulk schemas cap array sizes', () => {
  it('accepts arrays at the cap and rejects oversized ones', () => {
    expect(BulkEnrollUserIdsSchema.safeParse({ userIds: Array(500).fill('u') }).success).toBe(true);
    expect(BulkEnrollUserIdsSchema.safeParse({ userIds: Array(501).fill('u') }).success).toBe(false);

    expect(BulkEnrollEmailsSchema.safeParse({ emails: Array(500).fill('a@b.co') }).success).toBe(
      true,
    );
    expect(BulkEnrollEmailsSchema.safeParse({ emails: Array(501).fill('a@b.co') }).success).toBe(
      false,
    );

    expect(BulkImportUsersSchema.safeParse({ rows: Array(1000).fill({}) }).success).toBe(true);
    expect(BulkImportUsersSchema.safeParse({ rows: Array(1001).fill({}) }).success).toBe(false);
  });
});
