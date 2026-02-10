'use client';

import React from 'react';
import Link from 'next/link';
import { AlertCircle, Inbox, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

type Action =
  | { label: string; onClick: () => void }
  | { label: string; href: string };

function ActionButton({ action, variant = 'primary' }: { action: Action; variant?: 'primary' | 'secondary' }) {
  if ('href' in action) {
    return (
      <Button asChild variant={variant}>
        <Link href={action.href}>{action.label}</Link>
      </Button>
    );
  }
  return (
    <Button variant={variant} onClick={action.onClick}>
      {action.label}
    </Button>
  );
}

export function WorkflowLoadingState({
  title = '正在加载',
  message = '请稍候...',
}: {
  title?: string;
  message?: string;
}) {
  return (
    <div className="min-h-[70dvh] flex items-center justify-center px-4 py-12">
      <Card className="w-full max-w-xl border-sky-100 bg-white/80 shadow-xl shadow-blue-100/40">
        <CardHeader className="space-y-2">
          <CardTitle className="flex items-center gap-3 text-slate-900">
            <Loader2 className="h-5 w-5 animate-spin text-sky-600" />
            {title}
          </CardTitle>
          <p className="text-sm text-slate-600">{message}</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 animate-pulse">
            <div className="h-4 rounded bg-slate-200/70" />
            <div className="h-4 w-5/6 rounded bg-slate-200/70" />
            <div className="h-4 w-2/3 rounded bg-slate-200/70" />
            <div className="h-10 rounded bg-slate-200/60" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function WorkflowEmptyState({
  title,
  message,
  primaryAction,
  secondaryAction,
}: {
  title: string;
  message: string;
  primaryAction?: Action;
  secondaryAction?: Action;
}) {
  return (
    <div className="min-h-[70dvh] flex items-center justify-center px-4 py-12">
      <Card className="w-full max-w-xl border-sky-100 bg-white/80 shadow-xl shadow-blue-100/40">
        <CardHeader className="space-y-2">
          <CardTitle className="flex items-center gap-3 text-slate-900">
            <Inbox className="h-5 w-5 text-sky-600" />
            {title}
          </CardTitle>
          <p className="text-sm text-slate-600">{message}</p>
        </CardHeader>
        {(primaryAction || secondaryAction) && (
          <CardContent className="flex flex-col gap-3 sm:flex-row">
            {primaryAction && <ActionButton action={primaryAction} variant="primary" />}
            {secondaryAction && <ActionButton action={secondaryAction} variant="secondary" />}
          </CardContent>
        )}
      </Card>
    </div>
  );
}

export function WorkflowErrorState({
  title = '加载失败',
  message,
  traceId,
  retryAction,
  backAction,
}: {
  title?: string;
  message: string;
  traceId?: string | null;
  retryAction?: Action;
  backAction?: Action;
}) {
  return (
    <div className="min-h-[70dvh] flex items-center justify-center px-4 py-12">
      <Card className="w-full max-w-xl border-rose-100 bg-white/80 shadow-xl shadow-rose-100/40">
        <CardHeader className="space-y-2">
          <CardTitle className="flex items-center gap-3 text-slate-900">
            <AlertCircle className="h-5 w-5 text-rose-600" />
            {title}
          </CardTitle>
          <p className="text-sm text-slate-700">{message}</p>
          {traceId ? (
            <p className="text-xs text-slate-500">
              traceId: <span className="font-mono">{traceId}</span>
            </p>
          ) : null}
        </CardHeader>
        {(retryAction || backAction) && (
          <CardContent className="flex flex-col gap-3 sm:flex-row">
            {retryAction && <ActionButton action={retryAction} variant="primary" />}
            {backAction && <ActionButton action={backAction} variant="secondary" />}
          </CardContent>
        )}
      </Card>
    </div>
  );
}

