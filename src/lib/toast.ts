// /src/lib/toast.ts
import { toast as sonnerToast } from 'sonner';
import { truncate } from '@/lib/truncate';

/**
 * The name of the specific thing that changed, when the caller knows it.
 *
 * A blank or missing name falls back to the plain noun, so a record with no title never
 * produces a message like `"" deleted`.
 */
type NamedItem = { name?: string | null };

// Long enough for a real assignment or course title, short enough that a toast stays one or
// two lines. A cut title still beats a message that cannot say which item it meant.
const MAX_NAME_LENGTH = 40;

/** `"Pumping Lemma" deleted`, or `Assignment deleted` when there is no usable name. */
function outcome(item: string, verb: string, options?: NamedItem) {
  const name = options?.name?.trim();
  const subject = name ? `"${truncate(name, MAX_NAME_LENGTH)}"` : item;
  return showToast.success(`${subject} ${verb}`);
}

interface ToastOptions {
  description?: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

type ToastKind = 'success' | 'error' | 'warning' | 'info' | 'loading';

// Only errors interrupt (assertive/alert). Routine success, info, warning, and
// loading messages announce politely via role="status" so they don't cut off
// whatever a screen reader is currently reading.
const getA11yOptions = (type: ToastKind) => {
  const isError = type === 'error';
  return {
    role: isError ? 'alert' : 'status',
    ariaLive: isError ? ('assertive' as const) : ('polite' as const),
  };
};

export const showToast = {
  success: (message: string, options?: ToastOptions) => {
    return sonnerToast.success(message, {
      ...getA11yOptions('success'),
      description: options?.description,
      duration: options?.duration || 4000,
      action: options?.action,
    });
  },

  error: (message: string, options?: ToastOptions) => {
    return sonnerToast.error(message, {
      ...getA11yOptions('error'),
      description: options?.description,
      duration: options?.duration || 6000,
      action: options?.action,
    });
  },

  warning: (message: string, options?: ToastOptions) => {
    return sonnerToast.warning(message, {
      ...getA11yOptions('warning'),
      description: options?.description,
      duration: options?.duration || 5000,
      action: options?.action,
    });
  },

  info: (message: string, options?: ToastOptions) => {
    return sonnerToast.info(message, {
      ...getA11yOptions('info'),
      description: options?.description,
      duration: options?.duration || 4000,
      action: options?.action,
    });
  },

  loading: (message: string, options?: { description?: string }) => {
    // Don't dismiss loading toasts as they may be intentionally replaced
    return sonnerToast.loading(message, {
      ...getA11yOptions('loading'),
      description: options?.description,
    });
  },

  /**
   * Outcome messages for the ordinary add / edit / delete actions.
   *
   * These own the WORDING so it cannot drift: pass the kind of thing that changed and, when
   * you have it, the thing's own name. Call sites keep the noun (so the code still reads
   * plainly) while the verb, the casing and the punctuation live here. Before this, the same
   * operation said "Problem created!" in one place and "Problem updated." in another, and
   * three flows disagreed about whether to shout.
   *
   * House style, applied by `outcome` below:
   *   - sentence case, no trailing punctuation, and no "successfully" (a success toast
   *     already says that by being a success toast)
   *   - name the item when it is known, quoted and truncated, because "Assignment deleted"
   *     cannot tell you WHICH one when you are working through a list
   *
   *   showToast.created('Problem')                        -> Problem created
   *   showToast.deleted('Assignment', { name: title })    -> "Pumping Lemma" deleted
   */
  created: (item: string, options?: NamedItem) => outcome(item, 'created', options),
  updated: (item: string, options?: NamedItem) => outcome(item, 'updated', options),
  deleted: (item: string, options?: NamedItem) => outcome(item, 'deleted', options),
  /** Attached something that already existed, e.g. an existing problem onto an assignment. */
  added: (item: string, options?: NamedItem) => outcome(item, 'added', options),
  /** Unlinked from something, but not destroyed. Deliberately distinct from `deleted`. */
  removed: (item: string, options?: NamedItem) => outcome(item, 'removed', options),
  duplicated: (item: string, options?: NamedItem) => outcome(item, 'duplicated', options),
  imported: (item: string, options?: NamedItem) => outcome(item, 'imported', options),

  saved: (itemName?: string) => {
    return showToast.success(itemName ? `${itemName} saved` : 'Changes saved', {
      duration: 3000,
    });
  },

  validationError: (message?: string) => {
    return sonnerToast.error('Validation Error', {
      ...getA11yOptions('error'),
      description: message || 'Please check all required fields.',
      duration: 6000,
    });
  },

  networkError: () => {
    return sonnerToast.error('Connection Error', {
      ...getA11yOptions('error'),
      description: 'Please check your internet connection and try again.',
      duration: 8000,
      action: {
        label: 'Retry',
        onClick: () => window.location.reload(),
      },
    });
  },

  unauthorized: () => {
    return sonnerToast.error('Access Denied', {
      ...getA11yOptions('error'),
      description: 'You do not have permission to perform this action.',
      duration: 6000,
    });
  },

  serverError: () => {
    return sonnerToast.error('Server Error', {
      ...getA11yOptions('error'),
      description: 'Something went wrong on our end. Please try again later.',
      duration: 8000,
    });
  },

  // Update existing toast
  update: (
    id: string | number,
    type: 'success' | 'error' | 'warning' | 'info',
    message: string,
    options?: ToastOptions,
  ) => {
    return sonnerToast[type](message, {
      id,
      ...getA11yOptions(type),
      description: options?.description,
      duration: options?.duration,
      action: options?.action,
    });
  },

  // Dismiss toast
  dismiss: (id?: string | number) => {
    return sonnerToast.dismiss(id);
  },
};
