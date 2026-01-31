# 状态管理清理检查清单
# State Management Cleanup Checklist

**创建时间**: 2025-10-16
**状态**: 待执行 (Pending Execution)
**前置条件**: 确保完整流程 `/patients/[id]/*` 可以完全跑通

---

## 📋 Phase 2: 删除简化流程路由 (Delete Simplified Flow Routes)

### 路由文件 (Route Files) - 4个文件

```bash
# 简化上传流程 (Simplified upload flow)
src/app/upload/page.tsx                    # 106行 - 使用 useAppContext

# 简化提取流程 (Simplified extraction flow)
src/app/extract/page.tsx                   # 使用 useAppContext

# 简化结果流程 (Simplified results flow)
src/app/results/page.tsx                   # 使用 useAppContext

# 简化仪表盘 (Simplified dashboard)
src/app/dashboard/page.tsx                 # 132行 - 使用 useAppContext
```

**删除原因**: 完整流程 `/patients/[id]/*` 已提供相同功能，这些是冗余实现。

---

## 🔗 Phase 1.3: 删除 AppContext (Delete AppContext)

### Context 文件 (Context Files) - 1个文件

```bash
src/context/AppContext.tsx                 # 153行 - 仅被简化流程使用
```

**删除原因**: 仅被即将删除的简化流程使用，无保留价值。

---

## 🪝 删除简化流程专属 Hooks (Delete Simplified Flow Hooks)

### Hook 文件 (Hook Files) - 4个文件

```bash
src/hooks/useUpload.ts                     # 简化流程上传hook
src/hooks/useExtraction.ts                 # 简化流程提取hook
src/hooks/useMatch.ts                      # 简化流程匹配hook
src/hooks/useSavedTrials.ts               # 简化流程收藏hook
```

**删除原因**: 完整流程使用 TanStack Query，这些是旧架构遗留。

---

## 🎨 删除简化流程专属 UI 组件 (Delete Simplified Flow UI Components)

### 组件文件 (Component Files) - 可选清理

```bash
src/components/ui/UploadCard.tsx          # 仅被 /upload/page.tsx 使用
src/components/ui/LoadingOverlay.tsx      # 仅被 /upload/page.tsx 使用
src/components/ui/ResultCard.tsx          # 仅被 /results/page.tsx 使用
src/components/ui/TrialCard.tsx           # 被多处使用，需保留
src/components/ui/TrialFilterBar.tsx      # 仅被 /results/page.tsx 使用
src/components/ui/SaveButton.tsx          # 使用 useAppContext
src/components/ui/ScoreBar.tsx            # 仅被 ResultCard 使用
src/components/ui/Drawer.tsx              # 通用组件，可能其他地方使用
src/components/ui/ErrorBoundary.tsx       # 通用组件，应保留
```

**策略**: 先删除路由，编译时会显示哪些组件未被引用，再按需清理。

---

## 📝 需要更新的文件 (Files to Update)

### 1. Layout.tsx - 移除 AppProvider

```typescript
// 删除这段:
import { AppProvider } from '@/context/AppContext';

// 删除这段包装:
<AppProvider>
  {children}
</AppProvider>
```

### 2. Navigation.tsx - 移除简化流程链接 (如果有)

检查并移除指向 `/upload`, `/extract`, `/results`, `/dashboard` 的导航链接。

---

## ✅ 执行步骤 (Execution Steps)

### 第一步：备份确认
```bash
git status                                 # 确认当前状态
git add .                                  # 暂存当前更改
git commit -m "Checkpoint before cleanup" # 创建检查点
```

### 第二步：删除简化流程路由
```bash
rm -rf src/app/upload/
rm -rf src/app/extract/
rm -rf src/app/results/
rm -rf src/app/dashboard/
```

### 第三步：删除 AppContext
```bash
rm src/context/AppContext.tsx
```

### 第四步：删除专属 Hooks
```bash
rm src/hooks/useUpload.ts
rm src/hooks/useExtraction.ts
rm src/hooks/useMatch.ts
rm src/hooks/useSavedTrials.ts
```

### 第五步：更新 Layout
编辑 `src/app/layout.tsx`，移除 AppProvider。

### 第六步：编译验证
```bash
npm run dev                                # 启动开发服务器
# 检查编译错误，按需清理未使用的组件
```

### 第七步：提交清理
```bash
git add .
git commit -m "Phase 2: Remove simplified flow routes and AppContext"
```

---

## 📊 预期效果 (Expected Results)

### 代码行数减少
- 路由文件: ~400行
- AppContext: 153行
- Hooks: ~300行
- **总计**: ~850行代码删除

### 架构简化
- ✅ 单一数据流：TanStack Query (server state) + Zustand (client state)
- ✅ 单一流程：完整流程 `/patients/[id]/*`
- ✅ 消除冗余：移除并行实现
- ✅ 符合 Linus 好品味原则：No special cases

### 保留的核心架构
```
State Management (状态管理)
├─ TanStack Query      - Server state (API数据)
├─ Zustand/auth        - Auth state (认证)
├─ Zustand/patients    - Patient list (患者列表)
├─ Zustand/workflow    - Workflow state (完整流程状态)
└─ Zustand/uploadProgress - Upload progress (上传进度)
```

---

## ⚠️ 风险与缓解 (Risks & Mitigation)

### 风险1: 删除后发现有遗漏功能
**缓解**: Git commit 提供回滚能力

### 风险2: 第三方代码引用简化路由
**缓解**: 先编译检查，再逐步删除

### 风险3: 用户收藏数据丢失
**缓解**: 检查 localStorage，如需迁移先写迁移脚本

---

## 🎯 清理完成标准 (Completion Criteria)

- [ ] 所有简化流程路由已删除
- [ ] AppContext.tsx 已删除
- [ ] 专属 Hooks 已删除
- [ ] Layout.tsx 已更新
- [ ] `npm run dev` 编译成功，无错误
- [ ] 完整流程 `/patients/[id]/*` 功能正常
- [ ] 登录注册功能正常
- [ ] Git commit 已创建

---

**备注**: 本清单在 API 连接问题修复后执行。
