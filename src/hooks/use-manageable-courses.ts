'use client';

import { useEffect, useState } from 'react';
import { apiPaths } from '@/lib/api-paths';
import { apiClient } from '@/lib/api/fetch-client';
import { showToast } from '@/lib/toast';

/** A course the caller can manage, as returned by /api/me/manageable-courses. */
export type ManageableCourse = {
  id: string;
  name: string;
  code: string | null;
  semester: string | null;
  isArchived: boolean;
};

/** "Theory (CS 301) · Spring 2026 · Archived" style label for a source course. */
export function courseLabel(c: ManageableCourse): string {
  let label = c.name;
  if (c.code) label += ` (${c.code})`;
  if (c.semester) label += ` · ${c.semester}`;
  if (c.isArchived) label += ' · Archived';
  return label;
}

/**
 * Loads the courses the caller can manage (faculty/TA, or all for admins), excluding
 * `excludeCourseId`, whenever `open` becomes true. Shared by the import wizards.
 */
export function useManageableCourses(
  open: boolean,
  excludeCourseId: string,
): { courses: ManageableCourse[]; loading: boolean } {
  const [courses, setCourses] = useState<ManageableCourse[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const list = await apiClient.get<ManageableCourse[]>(
          apiPaths.myManageableCourses({ excludeCourseId }),
        );
        if (!cancelled) setCourses(list);
      } catch {
        if (!cancelled)
          showToast.error('Could not load your courses. Refresh the page to try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, excludeCourseId]);

  return { courses, loading };
}
