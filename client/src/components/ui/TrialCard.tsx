'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { MapPin, Building2, Microscope, ExternalLink } from 'lucide-react';
import { TrialMatch } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ScoreBar } from '@/components/ui/ScoreBar';
import { SaveButton } from '@/components/ui/SaveButton';

type TrialCardProps = {
  trial: TrialMatch;
  onViewDetails: (trial: TrialMatch) => void;
};

const cardVariants = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
};

export function TrialCard({ trial, onViewDetails }: TrialCardProps) {
  return (
    <motion.div
      variants={cardVariants}
      initial="initial"
      animate="animate"
      className="h-full"
    >
      <Card className="group h-full overflow-hidden rounded-3xl border border-white/60 bg-white/80 shadow-xl shadow-blue-100/50 backdrop-blur transition hover:-translate-y-1 hover:shadow-blue-200/60">
        <CardHeader className="border-b border-sky-100/60 bg-gradient-to-r from-white/90 to-sky-50/70">
          <div className="flex items-start justify-between gap-3">
            <CardTitle className="text-base font-semibold text-slate-900">
              {trial.title}
            </CardTitle>
            <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-600">
              {trial.matchScore}%
            </span>
          </div>
          <div className="mt-3 space-y-1 text-xs text-slate-500">
            {trial.phase && (
              <div className="flex items-center gap-2">
                <Microscope className="h-3.5 w-3.5 text-sky-500" />
                <span>分期：{trial.phase}</span>
              </div>
            )}
            {trial.institution && (
              <div className="flex items-center gap-2">
                <Building2 className="h-3.5 w-3.5 text-sky-500" />
                <span>{trial.institution}</span>
              </div>
            )}
            {(trial.siteCity || trial.siteCountry) && (
              <div className="flex items-center gap-2">
                <MapPin className="h-3.5 w-3.5 text-sky-500" />
                <span>
                  {[trial.siteCity, trial.siteCountry].filter(Boolean).join(' · ')}
                </span>
              </div>
            )}
          </div>
        </CardHeader>

        <CardContent className="flex h-full flex-col gap-4 p-6">
          <div>
            <p className="text-sm text-slate-600">
              {trial.condition ?? '适应症待确认'}
            </p>
            <ScoreBar value={trial.matchScore} className="mt-3" />
          </div>

          {trial.briefEligibility.length > 0 && (
            <div className="rounded-2xl border border-sky-100 bg-sky-50/70 p-4 text-xs text-slate-600">
              <p className="mb-2 font-medium text-slate-700">核心入组点</p>
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
              <ExternalLink className="mr-2 h-4 w-4" />
              查看详情
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
