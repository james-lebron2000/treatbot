'use client';

import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { patientSchema, PatientFormData } from '@/lib/schemas';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Modal';

interface PatientFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: PatientFormData) => Promise<void>;
  loading?: boolean;
  initialData?: Partial<PatientFormData>;
  mode?: 'create' | 'edit';
}

export function PatientForm({
  open,
  onOpenChange,
  onSubmit,
  loading = false,
  initialData,
  mode = 'create',
}: PatientFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<PatientFormData>({
    resolver: zodResolver(patientSchema),
    defaultValues: initialData,
  });

  const genderRegister = register('gender', {
    setValueAs: (value) => (value === '' ? undefined : value),
  });

  // Reset form when dialog opens/closes
  React.useEffect(() => {
    if (open) {
      reset(initialData);
    } else {
      reset();
    }
  }, [open, initialData, reset]);

  const handleFormSubmit = async (data: PatientFormData) => {
    try {
      await onSubmit(data);
      onOpenChange(false);
      reset();
    } catch (error) {
      console.error('Patient form submission failed', error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? '创建患者' : '编辑患者'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? '填写患者信息以创建档案。'
              : '更新患者信息。'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
          <Input
            {...register('name')}
            label="患者姓名"
            placeholder="请输入患者姓名（可用匿名代号）"
            error={errors.name?.message}
            disabled={loading}
          />

          <div className="space-y-2">
            <label className="text-sm font-medium leading-none text-gray-700">
              性别（可选）
            </label>
            <select
              {...genderRegister}
              disabled={loading}
              className="flex h-11 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-base sm:h-10 sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              defaultValue={initialData?.gender ?? ''}
            >
              <option value="">未填写</option>
              <option value="male">男</option>
              <option value="female">女</option>
              <option value="other">其他/未知</option>
            </select>
            {errors.gender?.message ? (
              <p className="text-sm text-red-600">{errors.gender.message}</p>
            ) : null}
          </div>

          <div className="space-y-4">
            <h4 className="text-sm font-medium text-gray-700">联系方式（可选）</h4>

            <Input
              {...register('contactInfo.email')}
              type="email"
              label="邮箱"
              placeholder="例如：patient@example.com"
              error={errors.contactInfo?.email?.message}
              disabled={loading}
            />

            <Input
              {...register('contactInfo.phone')}
              label="电话"
              placeholder="例如：13800000000"
              error={errors.contactInfo?.phone?.message}
              disabled={loading}
            />

            <Input
              {...register('contactInfo.address')}
              label="地址"
              placeholder="例如：上海市徐汇区..."
              error={errors.contactInfo?.address?.message}
              disabled={loading}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              取消
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={loading}
              disabled={loading}
            >
              {mode === 'create' ? '创建患者' : '保存修改'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
