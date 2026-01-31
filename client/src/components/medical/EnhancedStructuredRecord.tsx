import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, User, Heart, Activity, Pill, TestTube, Stethoscope, Calendar, TrendingUp, AlertCircle, CheckCircle, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Progress } from '@/components/ui/Progress';
import { JsonValue } from '@/types';
import { getFieldLabel } from '@/lib/clinical/fieldLabels';

interface EnhancedStructuredRecordProps {
  data: Record<string, JsonValue>;
  title?: string;
  className?: string;
  showRawData?: boolean;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

interface MedicalDataCategory {
  id: string;
  title: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  priority: number;
  fields: string[];
}

const MEDICAL_CATEGORIES: MedicalDataCategory[] = [
  {
    id: 'basic_info',
    title: '基本信息',
    icon: <User className="w-4 h-4" />,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    priority: 1,
    fields: ['age', 'gender', 'name', 'patient_id', 'basic_info']
  },
  {
    id: 'diagnosis',
    title: '诊断信息',
    icon: <Stethoscope className="w-4 h-4" />,
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    priority: 2,
    fields: ['primary_diagnosis', 'staging', 'staging_system', 'staging_value', 'pathology', 'diagnosis', 'medical_history']
  },
  {
    id: 'pathology',
    title: '病理信息',
    icon: <TestTube className="w-4 h-4" />,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
    priority: 3,
    fields: ['histology', 'grade', 'mvi_grade', 'pathology', 'biomarkers', 'mutations']
  },
  {
    id: 'treatment',
    title: '治疗历史',
    icon: <Pill className="w-4 h-4" />,
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    priority: 4,
    fields: ['systemic_treatments', 'previousTreatments', 'total_treatment_lines', 'last_treatment_date', 'treatment_history']
  },
  {
    id: 'lab_values',
    title: '实验室检查',
    icon: <Activity className="w-4 h-4" />,
    color: 'text-orange-600',
    bgColor: 'bg-orange-50',
    priority: 5,
    fields: ['lab_values', 'blood_counts', 'liver_function', 'renal_function', 'tumor_markers', 'lab_results']
  },
  {
    id: 'performance',
    title: '体能状态',
    icon: <Heart className="w-4 h-4" />,
    color: 'text-pink-600',
    bgColor: 'bg-pink-50',
    priority: 6,
    fields: ['ecog_score', 'kps_score', 'performance_status', 'current_status', 'estimated_survival_months']
  },
  {
    id: 'additional',
    title: '其他信息',
    icon: <Info className="w-4 h-4" />,
    color: 'text-gray-600',
    bgColor: 'bg-gray-50',
    priority: 7,
    fields: []
  }
];

const CRITICAL_FIELDS = [
  'primary_diagnosis', 'staging', 'age', 'gender', 'ecog_score',
  'measurable_lesions', 'organ_function_ok', 'estimated_survival_months'
];

const HIGH_CONFIDENCE_INDICATORS = ['confirmed', 'verified', 'documented', 'pathology_confirmed'];

type CategorizedEntry = { key: string; value: JsonValue; confidence: 'high' | 'medium' | 'low' };

const getFieldConfidence = (key: string, value: JsonValue): 'high' | 'medium' | 'low' => {
  const keyLower = key.toLowerCase();
  if (HIGH_CONFIDENCE_INDICATORS.some(indicator => keyLower.includes(indicator))) {
    return 'high';
  }

  if (typeof value === 'object' && value !== null && !Array.isArray(value) && 'confidence' in value) {
    const confidenceValue = (value as Record<string, JsonValue>).confidence;
    if (typeof confidenceValue === 'number') {
      if (confidenceValue >= 0.8) return 'high';
      if (confidenceValue >= 0.6) return 'medium';
      return 'low';
    }
  }

  if (CRITICAL_FIELDS.includes(key)) return 'high';
  return 'medium';
};

const getConfidenceBadge = (confidence: 'high' | 'medium' | 'low') => {
  const configs = {
    high: { color: 'bg-green-100 text-green-700', icon: <CheckCircle className="w-3 h-3" /> },
    medium: { color: 'bg-yellow-100 text-yellow-700', icon: <Info className="w-3 h-3" /> },
    low: { color: 'bg-red-100 text-red-700', icon: <AlertCircle className="w-3 h-3" /> }
  };

  const config = configs[confidence];
  return (
    <Badge className={`${config.color} text-xs`}>
      {config.icon}
      <span className="ml-1">{confidence === 'high' ? '高置信度' : confidence === 'medium' ? '中置信度' : '低置信度'}</span>
    </Badge>
  );
};

const organizeDataByCategories = (data: Record<string, JsonValue>) => {
  const categorizedData: Record<string, CategorizedEntry[]> = {};

  MEDICAL_CATEGORIES.forEach(cat => {
    categorizedData[cat.id] = [];
  });

  Object.entries(data).forEach(([key, value]) => {
    let foundCategory = false;

    for (const category of MEDICAL_CATEGORIES) {
      if (category.fields.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
        categorizedData[category.id].push({
          key,
          value,
          confidence: getFieldConfidence(key, value)
        });
        foundCategory = true;
        break;
      }
    }

    if (!foundCategory) {
      categorizedData.additional.push({
        key,
        value,
        confidence: getFieldConfidence(key, value)
      });
    }
  });

  return categorizedData;
};

const generateSummary = (data: Record<string, JsonValue>) => {
  const summary = {
    criticalFields: 0,
    totalFields: Object.keys(data).length,
    populatedFields: 0,
    confidenceScore: 0,
    keyFindings: [] as string[]
  };

  Object.entries(data).forEach(([key, value]) => {
    const isPopulated = value !== null && value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0);

    if (isPopulated) {
      summary.populatedFields += 1;
      if (CRITICAL_FIELDS.includes(key)) {
        summary.criticalFields += 1;
      }
    }

    const confidence = getFieldConfidence(key, value);
    summary.confidenceScore += confidence === 'high' ? 3 : confidence === 'medium' ? 2 : 1;
  });

  if (data.primary_diagnosis) {
    summary.keyFindings.push(`主要诊断: ${data.primary_diagnosis}`);
  }
  if (data.age) {
    summary.keyFindings.push(`患者年龄: ${data.age}岁`);
  }
  if (data.staging) {
    summary.keyFindings.push(`分期: ${data.staging}`);
  }

  return summary;
};

export function EnhancedStructuredRecord({
  data,
  title = '结构化医疗记录',
  className = '',
  showRawData = false,
  collapsible = true,
  defaultCollapsed = false
}: EnhancedStructuredRecordProps) {
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(
    new Set(defaultCollapsed ? MEDICAL_CATEGORIES.map(cat => cat.id) : [])
  );

  const toggleCategory = (categoryId: string) => {
    if (!collapsible) return;
    const newCollapsed = new Set(collapsedCategories);
    if (newCollapsed.has(categoryId)) {
      newCollapsed.delete(categoryId);
    } else {
      newCollapsed.add(categoryId);
    }
    setCollapsedCategories(newCollapsed);
  };

  const formatValue = (value: JsonValue, key: string = ''): React.ReactNode => {
    if (value === null || value === undefined || value === '') {
      return (
        <span className="text-gray-400 italic text-sm flex items-center">
          <AlertCircle className="w-3 h-3 mr-1" />
          未记录
        </span>
      );
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        return (
          <span className="text-gray-400 italic text-sm">空列表</span>
        );
      }
      return (
        <div className="flex flex-wrap gap-2">
          {value.map((item, index) => (
            <Badge key={index} variant="secondary" className="text-xs">
              {String(item)}
            </Badge>
          ))}
        </div>
      );
    }

    if (typeof value === 'object') {
      return (
        <div className="space-y-2">
          {Object.entries(value).map(([subKey, subValue]) => (
            <div key={subKey} className="flex items-start gap-3 pb-2 border-b border-gray-100 last:border-0 last:pb-0">
              <span className="text-gray-600 font-medium min-w-[90px] sm:min-w-[120px] text-xs tracking-wide shrink-0">
                {getFieldLabel(subKey)}：
              </span>
              <span className="text-gray-900 flex-1">
                {formatValue(subValue, subKey)}
              </span>
            </div>
          ))}
        </div>
      );
    }

    // Special formatting for specific field types
    if (key.includes('date') && typeof value === 'string') {
      return (
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-blue-500" />
          <span>{new Date(value).toLocaleDateString('zh-CN')}</span>
        </div>
      );
    }

    if (key.includes('score') || key.includes('grade')) {
      const numericValue = Number(value);
      if (!isNaN(numericValue)) {
        return (
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-green-500" />
            <Badge variant="outline">{numericValue}</Badge>
          </div>
        );
      }
    }

    return <span className="text-gray-900 font-medium">{String(value)}</span>;
  };

  const categorizedData = useMemo(() => organizeDataByCategories(data), [data]);
  const summary = useMemo(() => generateSummary(data), [data]);
  const completionPercentage = summary.totalFields > 0
    ? Math.round((summary.populatedFields / summary.totalFields) * 100)
    : 0;

  if (!data || Object.keys(data).length === 0) {
    return (
      <Card className={`${className}`}>
        <CardContent className="p-8 text-center">
          <div className="text-gray-400">
            <Stethoscope className="w-12 h-12 mx-auto mb-4" />
            <p className="text-lg font-medium">暂无结构化医疗记录</p>
            <p className="text-sm mt-2">请先进行医疗数据提取或上传病历文件</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={`${className}`}>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center">
              <Stethoscope className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-gray-900">{title}</h3>
              <p className="text-sm text-gray-600">结构化的患者医疗信息</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-sm">
              {summary.totalFields} 字段
            </Badge>
            <Badge variant="outline" className="text-sm">
              {summary.populatedFields} 已填充
            </Badge>
          </div>
        </div>

        {/* Summary Card */}
        <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
          <CardContent className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">{completionPercentage}%</div>
                <div className="text-xs text-gray-600">数据完整度</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{summary.criticalFields}</div>
                <div className="text-xs text-gray-600">关键字段</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">{summary.keyFindings.length}</div>
                <div className="text-xs text-gray-600">主要发现</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-600">
                  {Math.round(summary.confidenceScore / summary.totalFields)}
                </div>
                <div className="text-xs text-gray-600">平均置信度</div>
              </div>
            </div>

            <div className="mt-4">
              <Progress value={completionPercentage} className="h-2" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Key Findings */}
      {summary.keyFindings.length > 0 && (
        <Card className="mb-6 bg-gradient-to-r from-green-50 to-emerald-50 border-green-200">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle className="w-5 h-5 text-green-600" />
              关键发现
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {summary.keyFindings.map((finding, index) => (
                <div key={index} className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 bg-green-500 rounded-full mt-2 flex-shrink-0"></div>
                  <span className="text-sm text-gray-700">{finding}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Categorized Data Display */}
      <div className="space-y-4">
        {MEDICAL_CATEGORIES
          .filter(category => categorizedData[category.id].length > 0)
          .sort((a, b) => a.priority - b.priority)
          .map(category => {
            const isCollapsed = collapsedCategories.has(category.id);
            const categoryData = categorizedData[category.id];
            const populatedCount = categoryData.filter(item =>
              item.value !== null && item.value !== undefined && item.value !== ''
            ).length;

            return (
              <Card key={category.id} className={`border-2 ${isCollapsed ? 'border-gray-200' : `${category.bgColor} border-current`}`}>
                <CardHeader
                  className={`cursor-pointer hover:bg-gray-50 transition-colors ${isCollapsed ? '' : category.bgColor}`}
                  onClick={() => toggleCategory(category.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${category.bgColor} ${category.color}`}>
                        {category.icon}
                      </div>
                      <div>
                        <CardTitle className={`text-lg ${category.color}`}>
                          {category.title}
                        </CardTitle>
                        <p className="text-sm text-gray-600">
                          {populatedCount}/{categoryData.length} 字段已填充
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {populatedCount} 已填充
                      </Badge>
                      {collapsible && (
                        isCollapsed ?
                          <ChevronRight className="w-5 h-5 text-gray-400" /> :
                          <ChevronDown className="w-5 h-5 text-gray-400" />
                      )}
                    </div>
                  </div>
                </CardHeader>

                {!isCollapsed && (
                  <CardContent className="pt-0">
                    <div className="space-y-4">
                      {categoryData.map((item, index) => {
                        const displayKey = getFieldLabel(item.key) || item.key;

                        return (
                          <div key={item.key} className="group">
                            <div className="flex items-start justify-between mb-2">
                              <label className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                                <span className="text-gray-500 font-mono text-xs">
                                  {String(index + 1).padStart(2, '0')}
                                </span>
                                {displayKey}
                              </label>
                              <div className="flex items-center gap-2">
                                {getConfidenceBadge(item.confidence)}
                                {CRITICAL_FIELDS.includes(item.key) && (
                                  <Badge variant="destructive" className="text-xs">
                                    关键
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <div className="ml-6">
                              {formatValue(item.value, item.key)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
      </div>

      {/* Raw Data Toggle */}
      {showRawData && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-semibold text-gray-600 hover:text-blue-600 transition-colors">
            查看原始数据
          </summary>
          <pre className="mt-3 p-4 bg-gray-50 rounded-lg text-xs overflow-auto max-h-96">
            {JSON.stringify(data, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
