import { create } from 'zustand';
import { ClinicalArchive, JsonValue, StructuredData } from '@/types';

export interface Patient {
  id: string;
  name: string;
  patientId: string;
  contactInfo: {
    email?: string;
    phone?: string;
    address?: string;
  };
  createdAt: string;
  updatedAt: string;
  recordCount?: number;
  gender?: string;
  notes?: string;
  tags?: string[];
  dob?: string | null;
  latestRecordId?: string | null;
  latestStructuredData?: StructuredData | Record<string, JsonValue> | null;
  latestClinicalArchive?: ClinicalArchive | null;
  hasStructuredRecord?: boolean;
}

interface PatientState {
  patients: Patient[];
  currentPatient: Patient | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  setPatients: (patients: Patient[]) => void;
  addPatient: (patient: Patient) => void;
  updatePatient: (id: string, updates: Partial<Patient>) => void;
  deletePatient: (id: string) => void;
  setCurrentPatient: (patient: Patient | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
}

export const usePatientStore = create<PatientState>((set) => ({
  patients: [],
  currentPatient: null,
  isLoading: false,
  error: null,

  setPatients: (patients) => {
    set({ patients, error: null });
  },

  addPatient: (patient) => {
    set((state) => ({
      patients: [patient, ...state.patients],
      error: null,
    }));
  },

  updatePatient: (id, updates) => {
    set((state) => ({
      patients: state.patients.map((patient) =>
        patient.id === id ? { ...patient, ...updates } : patient
      ),
      currentPatient:
        state.currentPatient?.id === id
          ? { ...state.currentPatient, ...updates }
          : state.currentPatient,
      error: null,
    }));
  },

  deletePatient: (id) => {
    set((state) => ({
      patients: state.patients.filter((patient) => patient.id !== id),
      currentPatient:
        state.currentPatient?.id === id ? null : state.currentPatient,
      error: null,
    }));
  },

  setCurrentPatient: (patient) => {
    set({ currentPatient: patient });
  },

  setLoading: (loading) => {
    set({ isLoading: loading });
  },

  setError: (error) => {
    set({ error });
  },

  clearError: () => {
    set({ error: null });
  },
}));
