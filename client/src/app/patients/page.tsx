'use client';

// ============================================================================
// 患者列表页面 / Patient List Page
// ============================================================================
// 职责：
//   1. 展示用户的所有患者
//   2. 提供患者创建入口
//   3. 导航到患者详情页
// ============================================================================
// 设计原则：
//   - 使用 usePatients hook 获取数据
//   - Card 布局展示患者信息
//   - 响应式设计（移动端友好）
// ============================================================================

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { usePatients, useCreatePatient } from '@/lib/hooks';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { PatientForm } from '@/components/forms/PatientForm';
import { showToast } from '@/components/ui/Toast';
import type { PatientFormData } from '@/lib/schemas';

function formatGender(value?: string | null) {
  if (!value) return '';
  const normalized = String(value).toLowerCase();
  if (normalized === 'male' || normalized === 'm' || normalized === '男') return '男';
  if (normalized === 'female' || normalized === 'f' || normalized === '女') return '女';
  return value;
}

export default function PatientsPage() {
  const router = useRouter();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Fetch patients
  const { data: patients, isLoading, error } = usePatients();

  // Create patient mutation
  const { mutate: createPatient, isPending: isCreating } = useCreatePatient();

  // ============================================================================
  // Event Handlers
  // ============================================================================

  const handleCreatePatient = async (data: PatientFormData): Promise<void> => {
    return new Promise((resolve, reject) => {
      createPatient(data, {
        onSuccess: (result) => {
          showToast.success('患者创建成功');

          // 显示自动调整提示（如果 patientId 被后端修改）
          if (result.autoAdjustedPatientId) {
            showToast.info(
              `患者ID已自动调整为 ${result.autoAdjustedPatientId}`
            );
          }

          // 导航到上传步骤开始流程
          router.push(`/patients/${result.patient.id}/upload`);
          resolve();
        },
        onError: (error) => {
          showToast.error(
            error.message || '创建患者失败'
          );
          reject(error);
        },
      });
    });
  };

  // ============================================================================
  // Loading & Error States
  // ============================================================================

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <Alert variant="destructive" title="加载失败">
          {error.message || '无法加载患者列表，请稍后重试'}
        </Alert>
      </div>
    );
  }

  // ============================================================================
  // Main Render
  // ============================================================================

  return (
    <>
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              患者管理
            </h1>
            <p className="mt-2 text-sm text-gray-600">
              管理您的患者档案与医疗记录
            </p>
          </div>

          <Button
            variant="primary"
            onClick={() => setIsCreateModalOpen(true)}
            className="shadow-lg shadow-blue-200/70 w-full sm:w-auto"
          >
            <span>+ 新建患者</span>
          </Button>
        </motion.div>

        {/* Patient List */}
        {!patients || patients.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-12 text-center"
          >
            <div className="mx-auto max-w-md">
              <svg
                className="mx-auto h-12 w-12 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
              <h3 className="mt-4 text-lg font-medium text-gray-900">
                暂无患者
              </h3>
              <p className="mt-2 text-sm text-gray-500">
                创建您的第一个患者档案，开始上传与匹配
              </p>
              <div className="mt-6">
                <Button
                  variant="primary"
                  onClick={() => setIsCreateModalOpen(true)}
                >
                  <span>创建患者</span>
                </Button>
              </div>
            </div>
          </motion.div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {patients.map((patient, index) => (
              <motion.div
                key={patient.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                {(() => {
                  const destination = patient.hasStructuredRecord
                    ? `/patients/${patient.id}/results`
                    : `/patients/${patient.id}/upload`;
                  return (
                    <Link href={destination}>
                      <Card className="cursor-pointer transition-all hover:shadow-lg hover:shadow-blue-100/50">
                        <CardHeader>
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <CardTitle className="text-xl">
                                {patient.name}
                          </CardTitle>
                          <CardDescription className="mt-1">
                            患者ID：{patient.patientId}
                          </CardDescription>
                        </div>
                        {patient.hasStructuredRecord && (
                          <Badge variant="secondary">
                            已结构化
                          </Badge>
                        )}
                          </div>
                        </CardHeader>

                    <CardContent>
                      <div className="space-y-2 text-sm text-gray-600">
                        {/* Record Count */}
                        <div className="flex items-center gap-2">
                          <svg
                            className="h-4 w-4 text-gray-400"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                            />
                          </svg>
                          <span>
                            {patient.recordCount || 0} 条记录
                          </span>
                        </div>

                        {/* Gender */}
                        {patient.gender && (
                          <div className="flex items-center gap-2">
                            <svg
                              className="h-4 w-4 text-gray-400"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                              />
                            </svg>
                            <span>{formatGender(patient.gender)}</span>
                          </div>
                        )}

                        {/* Contact Info */}
                        {patient.contactInfo?.email && (
                          <div className="flex items-center gap-2 truncate">
                            <svg
                              className="h-4 w-4 flex-shrink-0 text-gray-400"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                              />
                            </svg>
                            <span className="truncate">
                              {patient.contactInfo.email}
                            </span>
                          </div>
                        )}

                        {/* Last Updated */}
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <svg
                            className="h-4 w-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                            />
                          </svg>
                          <span>
                            更新于 {new Date(patient.updatedAt).toLocaleDateString('zh-CN')}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                      </Card>
                    </Link>
                  );
                })()}
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Create Patient Form */}
      <PatientForm
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        onSubmit={handleCreatePatient}
        loading={isCreating}
        mode="create"
      />
    </>
  );
}
