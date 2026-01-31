# 如何查看既往上传的 Patient Records 和临床试验匹配结果

## 📋 当前系统架构概览

### 数据流程
```
Dashboard (/)
  → Patient List
    → Click Patient
      → Redirects to /patients/[id]/upload
        → Upload Page (Step 1)
          → Extract Page (Step 2)
            → Results Page (Step 3) ✅ 显示匹配结果和历史记录
```

## 🔍 当前可用的历史记录查看方式

### 1. **Results Page - Match History Card** (已实现)
**路径**: `/patients/[id]/results`

**功能**:
- ✅ 显示所有历史匹配记录
- ✅ 查看每次匹配的时间戳
- ✅ 对比当前结果与历史结果的差异（Added/Removed trials）
- ✅ 恢复历史匹配结果
- ✅ 显示匹配元数据（Provider, Total Trials, Matched Trials）

**使用方法**:
```typescript
// 在 Results Page 自动加载
useEffect(() => {
  if (currentRecordId) {
    loadMatchHistory(currentRecordId);
  }
}, [currentRecordId]);
```

**显示内容**:
- 匹配时间
- 匹配试验数量 (Matched / Total)
- Provider 信息
- View Diff 按钮：查看与当前结果的差异
- Restore 按钮：恢复到该历史版本

### 2. **Patient Detail Page** (部分实现)
**路径**: `/patients/[id]/page.tsx`

**当前功能**:
- ✅ 自动重定向到 `/upload` 页面
- ✅ 加载患者的所有 Medical Records
- ⚠️ Records 数据已加载但**未在 UI 展示**

**代码位置**:
```typescript
// Line 263-264
const patientRecords = await patientsApi.getPatientRecords(patientRouteId);
setRecords(patientRecords);
```

### 3. **Dashboard Page** (基础功能)
**路径**: `/`

**当前功能**:
- ✅ 显示所有患者列表
- ✅ 显示患者的 Record Count
- ✅ 点击患者跳转到上传页面

**缺失功能**:
- ❌ 无法直接查看历史记录
- ❌ 无法查看匹配结果概览

## 💡 推荐的查看历史记录流程

### 方案 A: 通过 Results Page（现有最佳方式）

1. **从 Dashboard 选择患者**
   ```
   Dashboard → Click Patient → Redirects to Upload
   ```

2. **导航到 Results Page**
   ```
   Upload Page → Step Navigation → Click "Find Clinical Trials" (Step 3)
   ```

3. **查看 Match History**
   - 自动加载该患者的所有匹配历史
   - 点击 "View Diff" 查看差异
   - 点击 "Restore" 恢复历史版本

### 方案 B: 直接访问（推荐添加）

**建议添加直接访问链接**:
```
/patients/[id]/history  (新建页面)
```

功能:
- 显示所有 Medical Records
- 显示每个 Record 的匹配历史
- 快速跳转到对应的匹配结果

## 🛠️ 改进建议

### 1. **添加 Patient History Page** (高优先级)

创建新页面: `/patients/[id]/history/page.tsx`

**功能列表**:
- [ ] 显示所有 Medical Records 时间线
- [ ] 每个 Record 显示:
  - 创建时间
  - 提取的数据字段数量
  - 匹配试验数量
  - 快速预览
- [ ] 点击 Record 展开详细信息
- [ ] 快速跳转到匹配结果页面

### 2. **增强 Dashboard 患者卡片** (中优先级)

在患者列表中添加:
```tsx
<div className="patient-card">
  <h3>{patient.name}</h3>
  <div className="quick-stats">
    <span>Records: {patient.recordCount}</span>
    <span>Last Upload: {patient.lastUploadDate}</span>
  </div>
  <div className="actions">
    <Button onClick={() => router.push(`/patients/${patient.id}/upload`)}>
      New Upload
    </Button>
    <Button onClick={() => router.push(`/patients/${patient.id}/history`)}>
      View History
    </Button>
  </div>
</div>
```

### 3. **添加快速访问按钮** (低优先级)

在各个页面添加导航:
```tsx
// Upload, Extract, Results 页面
<div className="quick-nav">
  <Button onClick={() => router.push(`/patients/${patientId}/history`)}>
    <History className="h-4 w-4" />
    View All Records
  </Button>
</div>
```

## 📊 数据结构说明

### Medical Record 数据结构
```typescript
interface MedicalRecord {
  _id: string;                    // Record ID
  userId: string;
  patientId: string;
  extractedText?: string;         // OCR 提取的文本
  structuredData?: StructuredData; // 结构化医疗数据
  clinicalArchive?: ClinicalArchive;
  matchHistory?: MatchHistoryEntry[]; // 匹配历史
  createdAt: string;
  updatedAt: string;
}
```

### Match History Entry 数据结构
```typescript
interface MatchHistoryEntry {
  _id: string;
  createdAt: string;
  matches: TrialMatch[];          // 匹配的临床试验
  metadata?: MatchProviderMetadata; // 匹配元数据
}
```

## 🎯 当前最佳实践

### 查看患者的所有匹配历史:

1. **导航到 Results Page**
   ```
   Dashboard → Select Patient → Upload → Extract → Results
   ```

2. **滚动到 "Match History" 卡片**
   - 位于页面底部
   - 显示所有历史匹配记录

3. **查看历史差异**
   - 点击 "View Diff"
   - 查看 Added Trials (绿色)
   - 查看 Removed Trials (红色)

4. **恢复历史版本**
   - 点击 "Restore"
   - 系统将当前匹配结果替换为历史版本

### 查看患者的 Medical Records:

**当前**: 数据已加载但未显示 UI

**代码位置**:
```typescript
// client/src/app/patients/[id]/page.tsx:263-264
const patientRecords = await patientsApi.getPatientRecords(patientRouteId);
setRecords(patientRecords); // ✅ 数据已存储在 state
```

**访问方式**: 需要添加 UI 组件来展示 `records` state

## 🔧 API 端点说明

### 获取患者所有 Records
```typescript
GET /api/patients/:patientId/records

Response:
{
  records: MedicalRecord[]
}
```

### 获取匹配历史
```typescript
GET /api/medical/records/:recordId/match-history

Response:
{
  history: MatchHistoryEntry[],
  latest: TrialMatch[],
  metadata: MatchProviderMetadata
}
```

### 恢复历史版本
```typescript
POST /api/medical/records/:recordId/restore-match/:historyId

Response:
{
  matches: TrialMatch[],
  metadata: MatchProviderMetadata
}
```

## 📝 总结

### 当前可行方案:
✅ **Results Page 的 Match History Card** - 最完整的历史记录查看功能

### 推荐改进:
1. 创建专门的 History Page
2. 在 Dashboard 添加 "View History" 按钮
3. 在 Patient Detail Page 显示 Records 列表

### 快速实现建议:
如果需要立即查看历史，使用现有的 Results Page 功能。
如果需要更好的用户体验，建议实现 Patient History Page。
