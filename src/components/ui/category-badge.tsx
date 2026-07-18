import { cn } from '@/lib/utils';

// Category → badge colors. Shared by the course Activity tab and the System Logs
// page so the category badges stay identical across both views.
const CATEGORY_STYLE: Record<string, string> = {
  SYSTEM:
    'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800/40 dark:text-gray-200 dark:border-gray-700',
  USER: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-200 dark:border-blue-800',
  COURSE:
    'bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-200 dark:border-indigo-800',
  ASSIGNMENT:
    'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-200 dark:border-purple-800',
  PROBLEM:
    'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-200 dark:border-green-800',
  SUBMISSION:
    'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-200 dark:border-orange-800',
  GRADE:
    'bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-900/30 dark:text-teal-200 dark:border-teal-800',
};

const DEFAULT_STYLE = CATEGORY_STYLE.SYSTEM;

export function CategoryBadge({ category }: { category?: string | null }) {
  // No category set: render blank (categories are read straight from the log; unset
  // entries just show nothing rather than a placeholder).
  if (!category) return null;

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium',
        CATEGORY_STYLE[category] ?? DEFAULT_STYLE,
      )}
    >
      {category}
    </span>
  );
}
