'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Building2, MapPin, Microscope } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { ScoreBar } from '@/components/ui/ScoreBar';
import { SaveButton } from '@/components/ui/SaveButton';
import { TrialMatch } from '@/types';

type ResultCardProps = {
  trial: TrialMatch;
  onViewDetails: (trial: TrialMatch) => void;
};

const cardVariants = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.45, ease: 'easeOut' as const } },
};

export function ResultCard({ trial, onViewDetails }: ResultCardProps) {
  const locationLabel = [trial.siteCity, trial.siteCountry]
    .filter((value): value is string => Boolean(value))
    .join(' · ');

  return (
    <motion.div variants={cardVariants} initial="initial" animate="animate">
      <Card className="group h-full overflow-hidden rounded-3xl border border-white/70 bg-white/80 shadow-xl shadow-blue-100/50 backdrop-blur transition hover:-translate-y-1 hover:shadow-blue-200/70">
        <CardHeader className="border-b border-sky-100/60 bg-gradient-to-br from-white/90 to-sky-50/70">
          <CardTitle className="flex items-start justify-between text-base font-semibold text-slate-900">
            <span className="flex-1 pr-3 leading-snug">{trial.title}</span>
            <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-600">
              匹配度 {trial.matchScore}%
            </span>
          </CardTitle>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            {trial.phase && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-3 py-1 text-sky-600">
                <Microscope className="h-3.5 w-3.5" />
                分期 {trial.phase}
              </span>
            )}
            {trial.institution && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-3 py-1">
                <Building2 className="h-3.5 w-3.5 text-sky-500" />
                {trial.institution}
              </span>
            )}
            {locationLabel && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-3 py-1">
                <MapPin className="h-3.5 w-3.5 text-sky-500" />
                {locationLabel}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex h-full flex-col gap-4 p-6">
          <div>
            <p className="text-sm leading-relaxed text-slate-600">
              {trial.condition ?? '适应症待确认'}
            </p>
            <ScoreBar value={trial.matchScore} className="mt-3" />
          </div>

          {trial.briefEligibility.length > 0 && (
            <div className="rounded-2xl border border-sky-100 bg-sky-50/70 px-4 py-3 text-xs text-slate-600">
              <p className="mb-2 font-medium text-slate-700">关键入组要点</p>
              <ul className="list-disc space-y-1 pl-4">
                {trial.briefEligibility.slice(0, 3).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-auto flex flex-wrap items-center gap-2">
            <SaveButton trialId={trial.id} />
            <Button
              variant="outline"
              size="sm"
              className="rounded-full border-sky-200 bg-white/70 text-sky-600 hover:border-sky-300 hover:text-sky-700"
              onClick={() => onViewDetails(trial)}
            >
              查看详情
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
