// ============================================================================
// 患者管理相关 React Hooks
// ============================================================================
// 职责：
//   1. 将患者 API 封装为 React hooks
//   2. 使用 TanStack Query 管理异步状态
//   3. 统一的错误处理和 loading 状态
//   4. 自动更新 Zustand store
// ============================================================================
// 设计原则：
//   - 简洁：每个 hook 只做一件事
//   - 声明式：组件只需关心状态，不关心如何获取
//   - 类型安全：完整的 TypeScript 支持
// ============================================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePatientStore, type Patient } from '@/lib/stores/patients';
import { patientsApi } from '@/lib/api/patients';
import type { PatientFormData } from '@/lib/schemas';
import { ApiError } from '@/lib/api';

// ============================================================================
// 查询 Hooks
// ============================================================================

/**
 * 获取所有患者列表 Hook
 *
 * 用法：
 * ```tsx
 * const { data: patients, isLoading, error } = usePatients();
 *
 * if (isLoading) return <Spinner />;
 * if (error) return <Error />;
 *
 * return <PatientList patients={patients} />;
 * ```
 *
 * 特性：
 * - 自动缓存（5 分钟内不重复请求）
 * - 支持后台数据刷新
 */
export function usePatients() {
  return useQuery<Patient[], ApiError>({
    queryKey: ['patients'],
    queryFn: patientsApi.getPatients,

    // 缓存 5 分钟
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * 获取单个患者信息 Hook
 *
 * 用法：
 * ```tsx
 * const { data: patient, isLoading, error } = usePatient(patientId);
 *
 * if (isLoading) return <Spinner />;
 * if (error) return <Error />;
 *
 * return <PatientDetail patient={patient} />;
 * ```
 *
 * 特性：
 * - 自动缓存（5 分钟）
 */
export function usePatient(id: string) {
  return useQuery<Patient, ApiError>({
    queryKey: ['patients', id],
    queryFn: () => patientsApi.getPatient(id),

    // 只在有 ID 时启用
    enabled: !!id,

    // 缓存 5 分钟
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * 获取患者的医疗记录 Hook
 *
 * 用法：
 * ```tsx
 * const { data: records, isLoading } = usePatientRecords(patientId);
 * ```
 */
export function usePatientRecords(patientId: string) {
  return useQuery({
    queryKey: ['patients', patientId, 'records'],
    queryFn: () => patientsApi.getPatientRecords(patientId),

    // 只在有 ID 时启用
    enabled: !!patientId,

    // 缓存 3 分钟
    staleTime: 3 * 60 * 1000,
  });
}

// ============================================================================
// 变更 Hooks (Mutations)
// ============================================================================

/**
 * 创建患者 Hook
 *
 * 用法：
 * ```tsx
 * const { mutate: createPatient, isPending } = useCreatePatient();
 *
 * const handleSubmit = (data: PatientFormData) => {
 *   createPatient(data, {
 *     onSuccess: (result) => {
 *       toast.success('患者创建成功');
 *       router.push(`/patients/${result.patient.id}`);
 *     }
 *   });
 * };
 * ```
 */
export function useCreatePatient() {
  const { addPatient } = usePatientStore();
  const queryClient = useQueryClient();

  return useMutation<
    { patient: Patient; autoAdjustedPatientId: string | null; message?: string },
    ApiError,
    PatientFormData
  >({
    mutationFn: patientsApi.createPatient,

    onSuccess: (response) => {
      // 1. 更新 Zustand store
      addPatient(response.patient);

      // 2. 刷新患者列表缓存
      queryClient.invalidateQueries({ queryKey: ['patients'] });

      // 3. 缓存新患者数据
      queryClient.setQueryData(['patients', response.patient.id], response.patient);
    },
  });
}

/**
 * 更新患者信息 Hook
 *
 * 用法：
 * ```tsx
 * const { mutate: updatePatient, isPending } = useUpdatePatient();
 *
 * const handleSubmit = (data: Partial<PatientFormData>) => {
 *   updatePatient(
 *     { id: patientId, data },
 *     {
 *       onSuccess: () => toast.success('更新成功')
 *     }
 *   );
 * };
 * ```
 */
export function useUpdatePatient() {
  const { updatePatient: updateStorePatient } = usePatientStore();
  const queryClient = useQueryClient();

  return useMutation<
    Patient,
    ApiError,
    { id: string; data: Partial<PatientFormData> }
  >({
    mutationFn: ({ id, data }) => patientsApi.updatePatient(id, data),

    onSuccess: (updatedPatient) => {
      // 1. 更新 Zustand store
      updateStorePatient(updatedPatient.id, updatedPatient);

      // 2. 更新 React Query 缓存
      queryClient.setQueryData(['patients', updatedPatient.id], updatedPatient);

      // 3. 刷新患者列表（以防列表中显示的字段也需要更新）
      queryClient.invalidateQueries({ queryKey: ['patients'] });
    },
  });
}

/**
 * 删除患者 Hook
 *
 * 用法：
 * ```tsx
 * const { mutate: deletePatient, isPending } = useDeletePatient();
 *
 * const handleDelete = (patientId: string) => {
 *   if (confirm('确定要删除此患者？')) {
 *     deletePatient(patientId, {
 *       onSuccess: () => {
 *         toast.success('患者已删除');
 *         router.push('/patients');
 *       }
 *     });
 *   }
 * };
 * ```
 */
export function useDeletePatient() {
  const { deletePatient: deleteStorePatient } = usePatientStore();
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, string>({
    mutationFn: patientsApi.deletePatient,

    onSuccess: (_, deletedId) => {
      // 1. 更新 Zustand store
      deleteStorePatient(deletedId);

      // 2. 移除该患者的缓存
      queryClient.removeQueries({ queryKey: ['patients', deletedId] });

      // 3. 刷新患者列表
      queryClient.invalidateQueries({ queryKey: ['patients'] });
    },
  });
}

// ============================================================================
// 类型导出
// ============================================================================

export type { Patient, PatientFormData };
