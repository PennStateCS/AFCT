import { Badge } from '@/components/ui/badge';
import { ACTIVITY_CATEGORY_BADGE, ACTIVITY_CATEGORY_FALLBACK } from '@/lib/badge-presets';

/**
 * An activity-log category, in its categorical hue.
 *
 * Shared by the course Activity tab and the System Logs page so the two cannot drift. The
 * colours used to be written here as raw palette classes with their own dark: variants, which
 * is how Grade ended up teal, the one place in the product still using that colour.
 *
 * The label is the log's own category string and is left exactly as it arrives, uppercase
 * included: it is data, not a heading, and rewriting it here would stop it matching what the
 * log actually stores.
 */
export function CategoryBadge({
  category,
  className,
}: {
  category?: string | null;
  /** Per-caller sizing, e.g. a fixed width so a column of these lines up. Nothing else. */
  className?: string;
}) {
  // No category set: render nothing. Categories are read straight from the log, and an unset
  // entry is blank rather than a placeholder.
  if (!category) return null;

  const variant =
    ACTIVITY_CATEGORY_BADGE[category as keyof typeof ACTIVITY_CATEGORY_BADGE] ??
    ACTIVITY_CATEGORY_FALLBACK;

  return (
    <Badge variant={variant} className={className}>
      {category}
    </Badge>
  );
}

export default CategoryBadge;
