'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Filter, RotateCcw } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { ScoreBar } from '@/components/ui/ScoreBar';
import { cn } from '@/lib/utils';
import { PhaseFilterOption, TrialFilterState } from '@/hooks/useTrialsFilters';

type TrialFilterBarProps = {
  filters: TrialFilterState;
  phaseOptions: PhaseFilterOption[];
  institutions: string[];
  locations: string[];
  activeFilterCount: number;
  onPhaseChange: (value: PhaseFilterOption) => void;
  onInstitutionChange: (value: string) => void;
  onLocationChange: (value: string) => void;
  onMinScoreChange: (value: number) => void;
  onSearchChange: (value: string) => void;
  onReset: () => void;
  className?: string;
};

export function TrialFilterBar({
  filters,
  phaseOptions,
  institutions,
  locations,
  activeFilterCount,
  onPhaseChange,
  onInstitutionChange,
  onLocationChange,
  onMinScoreChange,
  onSearchChange,
  onReset,
  className,
}: TrialFilterBarProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className={cn(
        'flex flex-col gap-4 rounded-3xl border border-white/60 bg-white/80 p-6 shadow-lg shadow-blue-100/50 backdrop-blur',
        className
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Filter className="h-4 w-4 text-sky-500" />
          <span>
            智能筛选
            {activeFilterCount > 0 && <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-600">{activeFilterCount}</span>}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onReset}
          className="rounded-full border border-sky-100 bg-white/70 text-sky-600 hover:bg-sky-50"
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          重置筛选
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Select value={filters.phase} onValueChange={(value) => onPhaseChange(value as PhaseFilterOption)}>
          <SelectTrigger className="h-11 rounded-2xl border-sky-200 bg-white/70">
            <SelectValue placeholder="分期" />
          </SelectTrigger>
          <SelectContent>
            {phaseOptions.map((option) => (
              <SelectItem key={option} value={option}>
                {option === 'all' ? '全部分期' : `第 ${option} 期`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.institution} onValueChange={onInstitutionChange}>
          <SelectTrigger className="h-11 rounded-2xl border-sky-200 bg-white/70">
            <SelectValue placeholder="研究机构" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部机构</SelectItem>
            {institutions.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.location} onValueChange={onLocationChange}>
          <SelectTrigger className="h-11 rounded-2xl border-sky-200 bg-white/70">
            <SelectValue placeholder="试验区域" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部地区</SelectItem>
            {locations.map((loc) => (
              <SelectItem key={loc} value={loc}>
                {loc}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="rounded-2xl border border-sky-100 bg-white/70 px-4 py-3">
          <p className="text-xs font-medium text-slate-500">最低匹配度</p>
          <div className="mt-2 flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={filters.minScore}
              onChange={(event) => onMinScoreChange(Number(event.target.value))}
              className="flex-1 accent-sky-500"
            />
            <span className="w-10 text-right text-xs text-slate-600">{filters.minScore}%</span>
          </div>
          <ScoreBar value={filters.minScore} className="mt-2" />
        </div>
      </div>

      <Input
        value={filters.searchTerm}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder="搜索试验名称、机构或 NCT 编号"
        className="h-11 rounded-2xl border-sky-200 bg-white/80"
      />
    </motion.div>
  );
}
