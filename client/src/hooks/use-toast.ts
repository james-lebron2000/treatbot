import { useMemo } from 'react';
import toast from 'react-hot-toast';

import { showToast } from '@/components/ui/Toast';

type ToastFn = typeof showToast;

interface UseToastReturn {
  toast: ToastFn;
  dismiss: (id?: string) => void;
}

export function useToast(): UseToastReturn {
  const api = useMemo(() => ({
    toast: showToast,
    dismiss: (id?: string) => toast.dismiss(id),
  }), []);

  return api;
}
