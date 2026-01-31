import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Progress } from '@/components/ui/Progress';
import { AlertTriangle, CheckCircle2, Info, User, Activity, Heart, Stethoscope, TrendingUp } from 'lucide-react';
import { JsonValue } from '@/types';

interface MedicalDataSummaryProps {
  data: Record<string, JsonValue>;
  className?: string;
  showAlerts?: boolean;
}

interface MedicalSummary {
  patientInfo: {
    age?: number;
    gender?: string;
    primaryDiagnosis?: string;
    stage?: string;
  };
  clinicalStatus: {
    ecogScore?: number;
    performanceStatus?: string;
    measurableLesions?: boolean;
    organFunction?: boolean;
  };
  treatmentHistory: {
    previousTreatments: string[];
    totalLines?: number;
    lastTreatment?: string;
  };
  keyFindings: {
    critical: string[];
    warnings: string[];
    notes: string[];
  };
  dataQuality: {
    completion: number;
    criticalFields: number;
    totalCriticalFields: number;
    totalFields: number;
  };
}

export function MedicalDataSummary({ data, className = '', showAlerts = true }: MedicalDataSummaryProps) {
  const extractMedicalSummary = (data: Record<string, JsonValue>): MedicalSummary => {
    const summary: MedicalSummary = {
      patientInfo: {},
      clinicalStatus: {},
      treatmentHistory: {
        previousTreatments: []
      },
      keyFindings: {
        critical: [],
        warnings: [],
        notes: []
      },
      dataQuality: {
        completion: 0,
        criticalFields: 0,
        totalCriticalFields: 8,
        totalFields: 0
      }
    };

    // Extract patient information
    const age = extractValue(data, ['age', 'basic_info.age', 'medical_history.age']);
    if (age) summary.patientInfo.age = Number(age);

    const gender = extractValue(data, ['gender', 'basic_info.gender']);
    if (gender) summary.patientInfo.gender = String(gender);

    const diagnosis = extractValue(data, ['primary_diagnosis', 'diagnosis', 'medical_history.primary_diagnosis']);
    if (diagnosis) summary.patientInfo.primaryDiagnosis = String(diagnosis);

    const stage = extractValue(data, ['staging', 'staging_value', 'stage', 'medical_history.staging']);
    if (stage) summary.patientInfo.stage = String(stage);

    // Extract clinical status
    const ecog = extractValue(data, ['ecog_score', 'ecog', 'performance_status.ecog']);
    if (ecog) summary.clinicalStatus.ecogScore = Number(ecog);

    const measurable = extractValue(data, ['measurable_lesions', 'current_status.measurable_lesions']);
    if (measurable !== undefined) summary.clinicalStatus.measurableLesions = Boolean(measurable);

    const organFunction = extractValue(data, ['organ_function_ok', 'current_status.organ_function_ok']);
    if (organFunction !== undefined) summary.clinicalStatus.organFunction = Boolean(organFunction);

    // Extract treatment history
    const treatments = extractValue(data, ['systemic_treatments', 'previousTreatments', 'treatment_history.systemic_treatments']);
    if (Array.isArray(treatments)) {
      summary.treatmentHistory.previousTreatments = treatments.map(t => String(t));
    }

    const totalLines = extractValue(data, ['total_treatment_lines', 'totalTreatmentLines']);
    if (totalLines) summary.treatmentHistory.totalLines = Number(totalLines);

    // Generate key findings and alerts
    generateClinicalAlerts(data, summary);

    // Calculate data quality
    calculateDataQuality(data, summary);

    return summary;
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

  const generateClinicalAlerts = (data: Record<string, JsonValue>, summary: MedicalSummary) => {
    // Critical findings
    const age = summary.patientInfo.age;
    if (age && age > 75) {
      summary.keyFindings.critical.push(`高龄患者 (${age}岁)，需要特别关注治疗耐受性`);
    }

    const ecog = summary.clinicalStatus.ecogScore;
    if (ecog !== undefined) {
      if (ecog > 2) {
        summary.keyFindings.critical.push(`体能状态较差 (ECOG ${ecog})，可能不适合积极治疗`);
      } else {
        summary.keyFindings.notes.push(`体能状态良好 (ECOG ${ecog})`);
      }
    }

    if (summary.clinicalStatus.measurableLesions === false) {
      summary.keyFindings.critical.push('无可测量病灶，可能影响疗效评估');
    }

    if (summary.clinicalStatus.organFunction === false) {
      summary.keyFindings.critical.push('器官功能不佳，需要调整治疗方案');
    }

    // Warnings
    const stage = summary.patientInfo.stage;
    if (stage) {
      if (stage.includes('IV') || stage.includes('4')) {
        summary.keyFindings.warnings.push('晚期疾病，预后相对较差');
      }
    }

    // Treatment-related warnings
    if (summary.treatmentHistory.totalLines && summary.treatmentHistory.totalLines >= 3) {
      summary.keyFindings.warnings.push('多线治疗史，后续治疗选择有限');
    }
  };

  const calculateDataQuality = (data: Record<string, JsonValue>, summary: MedicalSummary) => {
    const criticalFields = ['age', 'gender', 'primary_diagnosis', 'staging', 'ecog_score'];
    let populatedCriticalFields = 0;

    criticalFields.forEach(field => {
      const value = extractValue(data, [field]);
      if (value !== undefined && value !== null && value !== '') {
        populatedCriticalFields++;
      }
    });

    summary.dataQuality.criticalFields = populatedCriticalFields;
    summary.dataQuality.totalFields = Object.keys(data).length;
    summary.dataQuality.completion = Math.round((populatedCriticalFields / criticalFields.length) * 100);
  };

  const summary = extractMedicalSummary(data);

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Patient Overview Card */}
      <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <User className="w-5 h-5 text-blue-600" />
            患者概览
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <User className="w-4 h-4" />
                <span>基本信息</span>
              </div>
              <div className="text-lg font-semibold">
                {summary.patientInfo.age ? `${summary.patientInfo.age}岁` : '年龄未知'}
                {summary.patientInfo.gender && (
                  <Badge variant="outline" className="ml-2">
                    {summary.patientInfo.gender === 'male' ? '男' : summary.patientInfo.gender === 'female' ? '女' : summary.patientInfo.gender}
                  </Badge>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Stethoscope className="w-4 h-4" />
                <span>主要诊断</span>
              </div>
              <div className="text-lg font-semibold text-red-600">
                {summary.patientInfo.primaryDiagnosis || '未记录'}
              </div>
              {summary.patientInfo.stage && (
                <Badge variant="destructive" className="text-xs">
                  {summary.patientInfo.stage}
                </Badge>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Activity className="w-4 h-4" />
                <span>体能状态</span>
              </div>
              <div className="text-lg font-semibold">
                {summary.clinicalStatus.ecogScore !== undefined ? (
                  <Badge variant={summary.clinicalStatus.ecogScore <= 2 ? 'default' : 'destructive'}>
                    ECOG {summary.clinicalStatus.ecogScore}
                  </Badge>
                ) : (
                  '未评估'
                )}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Heart className="w-4 h-4" />
                <span>治疗状态</span>
              </div>
              <div className="text-lg font-semibold">
                {summary.treatmentHistory.totalLines ? (
                  <Badge variant="outline">
                    {summary.treatmentHistory.totalLines}线治疗
                  </Badge>
                ) : (
                  '初治'
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Data Quality Assessment */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="w-5 h-5 text-blue-600" />
            数据质量评估
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-gray-700">数据完整度</span>
                <span className="text-sm font-semibold">{summary.dataQuality.completion}%</span>
              </div>
              <Progress value={summary.dataQuality.completion} className="h-2" />
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2">
              <div className="text-center p-3 bg-green-50 rounded-lg">
                <div className="text-2xl font-bold text-green-600">
                  {summary.dataQuality.criticalFields}
                </div>
                <div className="text-xs text-gray-600">关键字段</div>
              </div>
              <div className="text-center p-3 bg-blue-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-600">
                  {summary.dataQuality.totalFields}
                </div>
                <div className="text-xs text-gray-600">总字段数</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Clinical Alerts */}
      {showAlerts && (
        <div className="space-y-3">
          {/* Critical Alerts */}
          {summary.keyFindings.critical.length > 0 && (
            <Card className="border-red-200 bg-red-50">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-red-700 text-sm">
                  <AlertTriangle className="w-4 h-4" />
                  关键发现
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-2">
                  {summary.keyFindings.critical.map((finding, index) => (
                    <div key={index} className="flex items-start gap-2 text-red-700 text-sm">
                      <div className="w-1.5 h-1.5 bg-red-500 rounded-full mt-2 flex-shrink-0" />
                      <span>{finding}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Warning Alerts */}
          {summary.keyFindings.warnings.length > 0 && (
            <Card className="border-yellow-200 bg-yellow-50">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-yellow-700 text-sm">
                  <Info className="w-4 h-4" />
                  注意事项
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-2">
                  {summary.keyFindings.warnings.map((finding, index) => (
                    <div key={index} className="flex items-start gap-2 text-yellow-700 text-sm">
                      <div className="w-1.5 h-1.5 bg-yellow-500 rounded-full mt-2 flex-shrink-0" />
                      <span>{finding}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Notes */}
          {summary.keyFindings.notes.length > 0 && (
            <Card className="border-green-200 bg-green-50">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-green-700 text-sm">
                  <CheckCircle2 className="w-4 h-4" />
                  积极因素
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-2">
                  {summary.keyFindings.notes.map((finding, index) => (
                    <div key={index} className="flex items-start gap-2 text-green-700 text-sm">
                      <div className="w-1.5 h-1.5 bg-green-500 rounded-full mt-2 flex-shrink-0" />
                      <span>{finding}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
