import React from 'react';
import toast, { Toaster, type ToastOptions } from 'react-hot-toast';

// Custom toast styles
const toastStyles = {
  success: {
    iconTheme: {
      primary: '#10B981',
      secondary: '#FFFFFF',
    },
    style: {
      background: '#F0FDF4',
      color: '#065F46',
      border: '1px solid #BBF7D0',
    },
  },
  error: {
    iconTheme: {
      primary: '#EF4444',
      secondary: '#FFFFFF',
    },
    style: {
      background: '#FEF2F2',
      color: '#991B1B',
      border: '1px solid #FECACA',
    },
  },
  loading: {
    iconTheme: {
      primary: '#3B82F6',
      secondary: '#FFFFFF',
    },
    style: {
      background: '#EFF6FF',
      color: '#1E40AF',
      border: '1px solid #DBEAFE',
    },
  },
};

// Toast component with custom styling
export function Toast() {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        duration: 4000,
        style: {
          background: '#FFFFFF',
          color: '#374151',
          border: '1px solid #E5E7EB',
          borderRadius: '8px',
          fontSize: '14px',
          maxWidth: '500px',
        },
        success: toastStyles.success,
        error: toastStyles.error,
        loading: toastStyles.loading,
      }}
    />
  );
}

// Toast utility functions
export const showToast = {
  success: (message: string) => {
    toast.success(message);
  },

  info: (message: string) => {
    toast(message, {
      icon: 'ℹ️',
      style: {
        background: '#EFF6FF',
        color: '#1E40AF',
        border: '1px solid #DBEAFE',
      }
    });
  },

  error: (message: string) => {
    toast.error(message);
  },

  loading: (message: string) => {
    return toast.loading(message);
  },

  promise: <T,>(
    promise: Promise<T>,
    {
      loading,
      success,
      error,
    }: {
      loading: string;
      success: string | ((data: T) => string);
      error: string | ((err: unknown) => string);
    }
  ) => {
    return toast.promise(promise, {
      loading,
      success,
      error,
    });
  },

  custom: (message: string, options?: ToastOptions) => {
    toast(message, options);
  },

  dismiss: (toastId?: string) => {
    toast.dismiss(toastId);
  },
};
