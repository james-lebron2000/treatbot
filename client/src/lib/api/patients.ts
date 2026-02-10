import { apiClient, unwrapResponse } from '@/lib/api';
import { Patient } from '@/lib/stores/patients';
import { PatientFormData } from '@/lib/schemas';
import { ClinicalArchive, MedicalRecord, StructuredData } from '@/types';

type RawContactInfo = {
  email?: string;
  phone?: string;
  address?: string;
};

type RawPatient = Partial<Omit<Patient, 'contactInfo' | 'recordCount'>> & {
  _id?: string;
  code?: string;
  contactInfo?: RawContactInfo;
  email?: string;
  phone?: string;
  recordCount?: number;
  recordsCount?: number;
  latestStructuredData?: StructuredData | null;
  latestRecordId?: string | null;
  hasStructuredRecord?: boolean;
  latestClinicalArchive?: ClinicalArchive | null;
  dob?: string | Date | null;
  createdAt?: string | Date;
  updatedAt?: string | Date;
};

const mapPatient = (raw?: RawPatient | null): Patient => {
  if (!raw) {
    return {
      id: '',
      name: '',
      patientId: '',
      contactInfo: {},
      createdAt: '',
      updatedAt: '',
      recordCount: 0,
      tags: [],
      hasStructuredRecord: false,
      notes: undefined,
      gender: undefined,
      dob: null,
      latestRecordId: null,
      latestStructuredData: null,
    };
  }

  const id = raw.id || raw._id || '';
  const contactInfo = raw.contactInfo ?? {};
  const createdAt = raw.createdAt ? new Date(raw.createdAt).toISOString() : '';
  const updatedAt = raw.updatedAt ? new Date(raw.updatedAt).toISOString() : '';
  const dob = raw.dob ? new Date(raw.dob).toISOString() : null;

  return {
    id,
    name: raw.name ?? '',
    patientId: raw.patientId ?? raw.code ?? '',
    contactInfo: {
      email: contactInfo.email ?? raw.email ?? undefined,
      phone: contactInfo.phone ?? raw.phone ?? undefined,
      address: contactInfo.address ?? undefined,
    },
    createdAt,
    updatedAt,
    recordCount: raw.recordCount ?? raw.recordsCount ?? 0,
    gender: raw.gender,
    notes: raw.notes,
    tags: raw.tags ?? [],
    dob,
    latestRecordId: raw.latestRecordId ?? null,
    latestStructuredData: raw.latestStructuredData ?? null,
    latestClinicalArchive: raw.latestClinicalArchive ?? null,
    hasStructuredRecord: Boolean(raw.hasStructuredRecord ?? raw.latestStructuredData),
  };
};

export const patientsApi = {
  // Get all patients for the current user
  getPatients: async (): Promise<Patient[]> => {
    try {
      const response = await apiClient.get('/patients');
      const { data } = unwrapResponse<{ patients?: RawPatient[] } | RawPatient[]>(response);

      // Defensive: ensure we have valid data
      if (!data) {
        return [];
      }

      const patients = Array.isArray(data)
        ? data
        : Array.isArray(data?.patients)
          ? data.patients
          : [];
      return patients.map(mapPatient);
    } catch (error: unknown) {
      const err = error as { name?: string; message?: string };
      if (err?.name === 'ApiError') throw error;
      throw new Error(err?.message || '患者列表加载失败，请稍后重试。');
    }
  },

  // Get a specific patient by ID
  getPatient: async (id: string): Promise<Patient> => {
    try {
      const response = await apiClient.get(`/patients/${id}`);
      const { data } = unwrapResponse<{ patient?: RawPatient } | RawPatient>(response);
      let patient: RawPatient | null = null;

      if (data && typeof data === 'object' && 'patient' in data) {
        patient = (data as { patient?: RawPatient }).patient ?? null;
      } else if (data && typeof data === 'object') {
        patient = data as RawPatient;
      }

      return mapPatient(patient);
    } catch (error: unknown) {
      const err = error as { name?: string; message?: string };
      if (err?.name === 'ApiError') throw error;
      throw new Error(err?.message || '患者详情加载失败，请稍后重试。');
    }
  },

  // Create a new patient
  createPatient: async (data: PatientFormData): Promise<{ patient: Patient; autoAdjustedPatientId: string | null; message?: string }> => {
    try {
      const response = await apiClient.post('/patients', data);
      const { data: payload, message } = unwrapResponse<{
        patient?: RawPatient;
        autoAdjustedPatientId?: string | null;
      } | RawPatient>(response);
      let rawPatient: RawPatient | null = null;

      // Defensive: ensure valid response
      if (!payload || typeof payload !== 'object') {
        throw new Error('服务器返回异常');
      }

      if (payload && typeof payload === 'object' && 'patient' in payload) {
        rawPatient = (payload as { patient?: RawPatient }).patient ?? null;
      } else if (payload && typeof payload === 'object') {
        rawPatient = payload as RawPatient;
      }

      const mapped = mapPatient(rawPatient);
      return {
        patient: mapped,
        autoAdjustedPatientId:
          (payload && 'autoAdjustedPatientId' in payload ? payload.autoAdjustedPatientId : null) ?? null,
        message,
      };
    } catch (error: unknown) {
      const err = error as { name?: string; message?: string };
      if (err?.name === 'ApiError') throw error;
      throw new Error(err?.message || '创建患者失败，请稍后重试。');
    }
  },

  // Update a patient
  updatePatient: async (id: string, data: Partial<PatientFormData>): Promise<Patient> => {
    try {
      const response = await apiClient.put(`/patients/${id}`, data);
      const { data: payload } = unwrapResponse<{ patient?: RawPatient } | RawPatient>(response);
      let rawPatient: RawPatient | null = null;

      // Defensive: ensure valid response
      if (!payload || typeof payload !== 'object') {
        throw new Error('服务器返回异常');
      }

      if (payload && typeof payload === 'object' && 'patient' in payload) {
        rawPatient = (payload as { patient?: RawPatient }).patient ?? null;
      } else if (payload && typeof payload === 'object') {
        rawPatient = payload as RawPatient;
      }

      return mapPatient(rawPatient);
    } catch (error: unknown) {
      const err = error as { name?: string; message?: string };
      if (err?.name === 'ApiError') throw error;
      throw new Error(err?.message || '更新患者信息失败，请稍后重试。');
    }
  },

  // Delete a patient
  deletePatient: async (id: string): Promise<void> => {
    try {
      await apiClient.delete(`/patients/${id}`);
    } catch (error: unknown) {
      const err = error as { name?: string; message?: string };
      if (err?.name === 'ApiError') throw error;
      throw new Error(err?.message || '删除患者失败，请稍后重试。');
    }
  },

  // Get patient's medical records
  getPatientRecords: async (patientId: string): Promise<MedicalRecord[]> => {
    try {
      const response = await apiClient.get(`/patients/${patientId}/records`);
      const { data } = unwrapResponse<{ records?: MedicalRecord[] } | MedicalRecord[]>(response);

      // Defensive: ensure we have valid data
      if (!data) {
        return [];
      }

      if (Array.isArray(data)) {
        return data;
      }
      if (Array.isArray(data?.records)) {
        return data.records;
      }
      return [];
    } catch (error: unknown) {
      const err = error as { name?: string; message?: string };
      if (err?.name === 'ApiError') throw error;
      throw new Error(err?.message || '患者病历记录加载失败，请稍后重试。');
    }
  },
};
