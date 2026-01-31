'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

export type MatchDelta = {
  added: number;
  removed: number;
  scoreChanged: number;
  timestamp: string;
};

export function MatchDeltaBanner({ delta, onClear }: { delta: MatchDelta | null; onClear: () => void }) {
  if (!delta) return null;

  const { added, removed, scoreChanged } = delta;
  const hasAny = added > 0 || removed > 0 || scoreChanged > 0;
  if (!hasAny) return null;

  return (
    <Card className="mb-4 border-blue-200 bg-blue-50">
      <CardContent className="py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm font-semibold text-blue-900">匹配结果已更新</div>
          <div className="flex flex-wrap items-center gap-2">
            {added > 0 && <Badge className="bg-green-100 text-green-800 border-green-200">新增 {added}</Badge>}
            {removed > 0 && <Badge className="bg-red-100 text-red-800 border-red-200">移除 {removed}</Badge>}
            {scoreChanged > 0 && <Badge className="bg-amber-100 text-amber-800 border-amber-200">分数变化 {scoreChanged}</Badge>}
            <button
              type="button"
              onClick={onClear}
              className="ml-1 text-xs font-semibold text-blue-700 hover:text-blue-900"
            >
              关闭
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
