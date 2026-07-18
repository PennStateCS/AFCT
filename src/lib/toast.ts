// /src/lib/toast.ts
import { toast as sonnerToast } from 'sonner';

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

  // Convenience methods for common use cases
  created: (itemName: string) => {
    return showToast.success(`${itemName} created successfully`);
  },

  updated: (itemName: string) => {
    return showToast.success(`${itemName} updated successfully`);
  },

  deleted: (itemName: string) => {
    return showToast.success(`${itemName} deleted successfully`);
  },

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
