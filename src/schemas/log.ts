import { z } from 'zod';

export const DownloadLogsSchema = z.object({
    cols: z.array(z.string()),
    begTime: z.string(),
    endTime: z.string(),
})
.strict().superRefine((d, ctx) => {
    if (d.cols.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cols'],
        message: 'Pick at least one field.',
      });
    }
});