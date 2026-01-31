import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Calendar, Clock } from 'lucide-react';
import { JsonValue } from '@/types';
import { getFieldLabel } from '@/lib/clinical/fieldLabels';

interface MedicalTimelineProps {
  data: Record<string, JsonValue>;
  className?: string;
}

interface TimelineEvent {
  id: string;
  date: Date;
  type: 'diagnosis' | 'treatment' | 'lab' | 'imaging' | 'symptom' | 'milestone';
  title: string;
  description: string;
  category: string;
  data: JsonValue;
  confidence?: 'high' | 'medium' | 'low';
}

interface TreatmentRecord {
  [key: string]: string | Date | number;
  type: string;
  regimen: string;
  startDate: Date;
  index: number;
}

interface LabRecord {
  [key: string]: Date | string | JsonValue;
  date: Date;
  type: string;
  summary: string;
  data: JsonValue;
}

interface ImagingRecord {
  [key: string]: Date | string | JsonValue;
  date: Date;
  type: string;
  findings: string;
  data: JsonValue;
}

const TIMELINE_CATEGORIES = {
  diagnosis: { color: 'bg-red-100 text-red-700', icon: '🩺' },
  treatment: { color: 'bg-green-100 text-green-700', icon: '💊' },
  lab: { color: 'bg-blue-100 text-blue-700', icon: '🧪' },
  imaging: { color: 'bg-purple-100 text-purple-700', icon: '📊' },
  symptom: { color: 'bg-yellow-100 text-yellow-700', icon: '📋' },
  milestone: { color: 'bg-indigo-100 text-indigo-700', icon: '🎯' }
};

export function MedicalTimeline({ data, className = '' }: MedicalTimelineProps) {
  const extractTimelineEvents = (data: Record<string, JsonValue>): TimelineEvent[] => {
    const events: TimelineEvent[] = [];

    // Extract diagnosis events
    const diagnosisDate = extractDate(data, ['diagnosis_date', 'date_of_diagnosis', 'medical_history.diagnosis_date']);
    const primaryDiagnosis = extractValue(data, ['primary_diagnosis', 'diagnosis', 'medical_history.primary_diagnosis']);
    if (diagnosisDate && primaryDiagnosis) {
      events.push({
        id: 'diagnosis-1',
        date: diagnosisDate,
        type: 'diagnosis',
        title: '确诊',
        description: `主要诊断: ${primaryDiagnosis}`,
        category: 'diagnosis',
        data: primaryDiagnosis,
        confidence: 'high'
      });
    }

    // Extract staging events
    const stagingDate = extractDate(data, ['staging_date', 'date_of_staging']);
    const stage = extractValue(data, ['staging', 'staging_value', 'stage']);
    if (stagingDate && stage) {
      events.push({
        id: 'staging-1',
        date: stagingDate,
        type: 'diagnosis',
        title: '分期评估',
        description: `分期: ${stage}`,
        category: 'diagnosis',
        data: stage,
        confidence: 'high'
      });
    }

    // Extract treatment events
    const treatments = extractTreatments(data);
    treatments.forEach((treatment, index) => {
      events.push({
        id: `treatment-${index}`,
        date: treatment.startDate,
        type: 'treatment',
        title: '开始治疗',
        description: `${treatment.type}: ${treatment.regimen}`,
        category: 'treatment',
        data: treatment as unknown as JsonValue,
        confidence: 'medium'
      });
    });

    // Extract lab events
    const labResults = extractLabResults(data);
    labResults.forEach((lab, index) => {
      events.push({
        id: `lab-${index}`,
        date: lab.date,
        type: 'lab',
        title: '实验室检查',
        description: lab.summary,
        category: 'lab',
        data: lab as unknown as JsonValue,
        confidence: 'high'
      });
    });

    // Extract imaging events
    const imagingResults = extractImagingResults(data);
    imagingResults.forEach((imaging, index) => {
      events.push({
        id: `imaging-${index}`,
        date: imaging.date,
        type: 'imaging',
        title: '影像学检查',
        description: `${imaging.type}: ${imaging.findings}`,
        category: 'imaging',
        data: imaging as unknown as JsonValue,
        confidence: 'high'
      });
    });

    // Sort events by date (newest first)
    return events.sort((a, b) => b.date.getTime() - a.date.getTime());
  };

  const extractDate = (data: Record<string, JsonValue>, paths: string[]): Date | null => {
    for (const path of paths) {
      const value = getNestedValue(data, path);
      if (value && typeof value === 'string') {
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
          return date;
        }
      }
    }
    return null;
  };

  const extractValue = (data: Record<string, JsonValue>, paths: string[]): JsonValue | undefined => {
    for (const path of paths) {
      const value = getNestedValue(data, path);
      if (value !== undefined && value !== null && value !== '') {
        return value;
      }
    }
    return undefined;
  };

  const getNestedValue = (obj: Record<string, JsonValue>, path: string): JsonValue | undefined => {
    return path.split('.').reduce<JsonValue | undefined>((current, key) => {
      if (current && typeof current === 'object' && !Array.isArray(current) && key in current) {
        return (current as Record<string, JsonValue>)[key];
      }
      return undefined;
    }, obj);
  };

  const extractTreatments = (data: Record<string, JsonValue>): TreatmentRecord[] => {
    const treatments: TreatmentRecord[] = [];

    const systemicTreatments = extractValue(data, ['systemic_treatments', 'previousTreatments', 'treatment_history.systemic_treatments']);
    if (Array.isArray(systemicTreatments)) {
      systemicTreatments.forEach((treatment, index) => {
        if (typeof treatment === 'string') {
          treatments.push({
            type: '系统治疗',
            regimen: treatment,
            startDate: new Date(), // Use current date as placeholder
            index
          });
        } else if (typeof treatment === 'object') {
          treatments.push({
            type: '系统治疗',
            regimen: JSON.stringify(treatment),
            startDate: new Date(),
            index
          });
        }
      });
    }

    return treatments;
  };

  const extractLabResults = (data: Record<string, JsonValue>): LabRecord[] => {
    const labs: LabRecord[] = [];

    const labResults = extractValue(data, ['lab_results', 'lab_values']);
    if (labResults && typeof labResults === 'object') {
      const date = extractDate(data, ['lab_date', 'date']) || new Date();

      // Extract key lab values
      const summaryParts: string[] = [];

      const hemoglobin = getNestedValue(labResults as Record<string, JsonValue>, 'blood_counts.Hemoglobin');
      if (hemoglobin) summaryParts.push(`Hb: ${hemoglobin}`);

      const platelets = getNestedValue(labResults as Record<string, JsonValue>, 'blood_counts.Platelets');
      if (platelets) summaryParts.push(`PLT: ${platelets}`);

      const alt = getNestedValue(labResults as Record<string, JsonValue>, 'liver_function.ALT');
      if (alt) summaryParts.push(`ALT: ${alt}`);

      if (summaryParts.length > 0) {
        labs.push({
          date,
          type: '血液检查',
          summary: summaryParts.join(', '),
          data: labResults
        });
      }
    }

    return labs;
  };

  const extractImagingResults = (data: Record<string, JsonValue>): ImagingRecord[] => {
    const imaging: ImagingRecord[] = [];

    // Look for imaging-related data
    const measurableLesions = extractValue(data, ['measurable_lesions', 'current_status.measurable_lesions']);
    if (measurableLesions !== undefined) {
      imaging.push({
        date: new Date(),
        type: '疗效评估',
        findings: measurableLesions ? '有可测量病灶' : '无可测量病灶',
        data: { measurableLesions }
      });
    }

    return imaging;
  };

  const formatEventDate = (date: Date) => {
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const getEventIcon = (type: TimelineEvent['type']) => {
    const config = TIMELINE_CATEGORIES[type];
    return (
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${config.color}`}>
        {config.icon}
      </div>
    );
  };

  const formatEventData = (event: TimelineEvent): React.ReactNode => {
    if (typeof event.data === 'string') {
      return <span className="text-gray-900">{event.data}</span>;
    }

    if (typeof event.data === 'object' && event.data !== null) {
      return (
        <div className="space-y-1 text-sm">
          {Object.entries(event.data).slice(0, 3).map(([key, value]) => (
            <div key={key} className="flex items-start justify-between gap-3">
              <span className="text-gray-600 shrink-0">{getFieldLabel(key)}：</span>
              <span className="text-gray-900 font-medium text-right break-words">{String(value)}</span>
            </div>
          ))}
        </div>
      );
    }

    return null;
  };

  const events = extractTimelineEvents(data);

  if (events.length === 0) {
    return (
      <Card className={`${className} opacity-60`}>
        <CardContent className="p-8 text-center">
          <div className="text-gray-400">
            <Calendar className="w-12 h-12 mx-auto mb-4" />
            <p className="text-lg font-medium">暂无时间线数据</p>
            <p className="text-sm mt-2">请先进行完整的医疗数据提取</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={`${className}`}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            医疗时间线
            <Badge variant="outline" className="text-sm">
              {events.length} 事件
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200"></div>

            <div className="space-y-6">
              {events.map((event, index) => (
                <div key={event.id} className="relative flex items-start gap-4">
                  {/* Event dot and line connection */}
                  <div className="relative z-10">
                    {getEventIcon(event.type)}
                    {index < events.length - 1 && (
                      <div className="absolute top-8 left-4 w-0.5 h-16 bg-gray-200"></div>
                    )}
                  </div>

                  {/* Event content */}
                  <div className="flex-1 min-w-0 pt-1">
                    <div className="flex items-start justify-between gap-4 mb-2">
                      <div className="flex-1">
                        <h4 className="font-semibold text-gray-900 mb-1">
                          {event.title}
                        </h4>
                        <p className="text-sm text-gray-600 mb-2">
                          {event.description}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <Clock className="w-3 h-3" />
                          <span>{formatEventDate(event.date)}</span>
                          {event.confidence && (
                            <Badge
                              variant="outline"
                              className={`text-xs ${
                                event.confidence === 'high' ? 'border-green-200 text-green-700' :
                                event.confidence === 'medium' ? 'border-yellow-200 text-yellow-700' :
                                'border-red-200 text-red-700'
                              }`}
                            >
                              {event.confidence === 'high' ? '高置信度' :
                               event.confidence === 'medium' ? '中置信度' : '低置信度'}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <Badge
                        variant="secondary"
                        className={`${TIMELINE_CATEGORIES[event.type].color} border-0`}
                      >
                        {event.category}
                      </Badge>
                    </div>

                    {/* Event data */}
                    {event.data && (
                      <div className="mt-3 p-3 bg-gray-50 rounded-lg border">
                        {formatEventData(event)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Helper function to convert data to timeline format
export function convertToTimelineData(data: Record<string, JsonValue>): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  // This is a simplified conversion - in a real implementation,
  // you would have more sophisticated logic to parse different data formats

  if (data.primary_diagnosis) {
    events.push({
      id: 'diagnosis-1',
      date: new Date(),
      type: 'diagnosis',
      title: '主要诊断',
      description: String(data.primary_diagnosis),
      category: '诊断',
      data: data.primary_diagnosis
    });
  }

  if (data.systemic_treatments && Array.isArray(data.systemic_treatments)) {
    data.systemic_treatments.forEach((treatment, index) => {
      events.push({
        id: `treatment-${index}`,
        date: new Date(Date.now() - index * 30 * 24 * 60 * 60 * 1000), // Approximate dates
        type: 'treatment',
        title: '系统治疗',
        description: String(treatment),
        category: '治疗',
        data: treatment
      });
    });
  }

  return events;
}

// Helper function to format data for timeline display
export function formatTimelineData(data: Record<string, JsonValue>) {
  return {
    events: convertToTimelineData(data),
    summary: {
      totalEvents: convertToTimelineData(data).length,
      dateRange: {
        start: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
        end: new Date()
      }
    }
  };
}
