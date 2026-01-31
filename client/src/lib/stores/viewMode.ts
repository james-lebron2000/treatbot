import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type TrialViewMode = 'public' | 'pro';

interface ViewModeState {
  trialViewMode: TrialViewMode;
  setTrialViewMode: (mode: TrialViewMode) => void;
}

export const useViewModeStore = create<ViewModeState>()(
  persist(
    (set) => ({
      trialViewMode: 'public',
      setTrialViewMode: (mode) => set({ trialViewMode: mode }),
    }),
    { name: 'view-mode-store' }
  )
);
