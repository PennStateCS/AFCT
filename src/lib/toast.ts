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

export const showToast = {
  success: (message: string, options?: ToastOptions) => {
    return sonnerToast.success(message, {
      description: options?.description,
      duration: options?.duration || 4000,
      action: options?.action,
    });
  },

  error: (message: string, options?: ToastOptions) => {
    return sonnerToast.error(message, {
      description: options?.description,
      duration: options?.duration || 6000,
      action: options?.action,
    });
  },

  warning: (message: string, options?: ToastOptions) => {
    return sonnerToast.warning(message, {
      description: options?.description,
      duration: options?.duration || 5000,
      action: options?.action,
    });
  },

  info: (message: string, options?: ToastOptions) => {
    return sonnerToast.info(message, {
      description: options?.description,
      duration: options?.duration || 4000,
      action: options?.action,
    });
  },

  loading: (message: string, options?: { description?: string }) => {
    // Don't dismiss loading toasts as they may be intentionally replaced
    return sonnerToast.loading(message, {
      description: options?.description,
    });
  },

  // Convenience methods for common use cases
  created: (itemName: string) => {
    return sonnerToast.success(`${itemName} created successfully`, {
      duration: 4000,
    });
  },

  updated: (itemName: string) => {
    return sonnerToast.success(`${itemName} updated successfully`, {
      duration: 4000,
    });
  },

  deleted: (itemName: string) => {
    return sonnerToast.success(`${itemName} deleted successfully`, {
      duration: 4000,
    });
  },

  saved: (itemName?: string) => {
    return sonnerToast.success(itemName ? `${itemName} saved` : 'Changes saved', {
      duration: 3000,
    });
  },

  validationError: (message?: string) => {
    return sonnerToast.error('Validation Error', {
      description: message || 'Please check all required fields.',
      duration: 6000,
    });
  },

  networkError: () => {
    return sonnerToast.error('Connection Error', {
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
      description: 'You do not have permission to perform this action.',
      duration: 6000,
    });
  },

  serverError: () => {
    return sonnerToast.error('Server Error', {
      description: 'Something went wrong on our end. Please try again later.',
      duration: 8000,
    });
  },

  // Update existing toast
  update: (id: string | number, type: 'success' | 'error' | 'warning' | 'info', message: string, options?: ToastOptions) => {
    return sonnerToast[type](message, {
      id,
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
