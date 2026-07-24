/**
 * `cn` and nothing else.
 *
 * The generic name is deliberate and stays: `@/lib/utils` is where shadcn/ui expects its
 * class merger, every vendored component under `components/ui/` imports it from here, and
 * `npx shadcn add` regenerates that exact path. Renaming it would be undone by the next
 * component we pull in.
 *
 * So do not treat this as a home for general helpers. Anything else goes in a module
 * named after what it does; see the `src/lib/` guidance in the Conventions reference.
 */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
