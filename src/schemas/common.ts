// src/schemas/common.ts
import { z } from 'zod';

export const IdSchema = z.string().min(1, 'Missing id.');

export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const DateOnly = z
  .union([z.string(), z.date()])
  .transform((v) => (typeof v === 'string' ? new Date(`${v}T00:00:00`) : v))
  .refine((d) => d instanceof Date && !isNaN(d.getTime()), 'Invalid date.');
