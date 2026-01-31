'use client';

import React from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export function MissingConfirmBanner({
  items,
  onConfirm,
}: {
  items: string[];
  onConfirm: () => void;
}) {
  if (!items.length) return null;

  return (
    <Card className="border-amber-200 bg-amber-50">
      <CardContent className="py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            <div className="mt-0.5 text-amber-700">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-semibold text-amber-900">
                有 {items.length} 项关键信息在病历中未找到
              </div>
              <div className="text-xs text-amber-900/80">
                为了让你先看到可报名的临床试验，我们将这些信息<strong>暂按“满足/可用”展示</strong>，但需要你进一步确认或补充。
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {items.slice(0, 8).map((label) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-white px-2 py-0.5 text-xs text-amber-800"
                  >
                    <CheckCircle2 className="h-3 w-3" />
                    {label}
                  </span>
                ))}
                {items.length > 8 ? (
                  <span className="text-xs text-amber-700">+ {items.length - 8} 项</span>
                ) : null}
              </div>
            </div>
          </div>

          <Button onClick={onConfirm} variant="primary" size="sm" className="shrink-0">
            去确认/补齐
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
