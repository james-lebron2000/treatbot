# API 参考（后端）

后端默认前缀：`/api`

## 1. 统一响应格式

成功：
```json
{ "success": true, "message": "OK", "data": {}, "meta": {}, "traceId": "..." }
```

失败：
```json
{ "success": false, "message": "Request failed", "code": "bad_request", "details": {}, "traceId": "..." }
```

> 前端 `apiClient` 会自动把成功响应解包为 `data`，调用方无需手动访问 `response.data.data`。

## 2. 认证（Auth）

### POST `/api/auth/register`
- 说明：注册并返回 token
- Body：`{ email, password, name, acceptComplianceSecurityAgreement }`

### POST `/api/auth/login`
- 说明：登录并返回 token
- Body：`{ email, password }`

### GET `/api/auth/me`
- 说明：获取当前用户信息
- Header：`Authorization: Bearer <token>`

### PATCH `/api/auth/profile`
- 说明：更新用户资料（name/email）
- Header：`Authorization: Bearer <token>`

### POST `/api/auth/change-password`
- 说明：修改密码
- Header：`Authorization: Bearer <token>`
- Body：`{ currentPassword, newPassword }`

## 3. 患者（Patients）

所有 `/api/patients/*` 需要 `Authorization`。

- GET `/api/patients`：患者列表
- POST `/api/patients`：创建患者
- GET `/api/patients/:id`：患者详情
- PUT `/api/patients/:id`：更新患者
- DELETE `/api/patients/:id`：删除患者
- GET `/api/patients/:id/records`：患者关联的病历记录

## 4. 病历上传/解析/匹配（Medical）

所有 `/api/medical/*`（除健康检查外）需要 `Authorization`。

### POST `/api/medical/upload`
- 说明：上传文件并 OCR/抽取
- Content-Type：`multipart/form-data`

### POST `/api/medical/parse`
- 说明：解析医疗文本为结构化信息
- Body：`{ text: string, useLLM?: boolean }`

### POST `/api/medical/match/:recordId/start`
- 说明：启动批量匹配任务（用于结果页流式体验）
- Body（示例）：
  - `batchSize?: number`
  - `restart?: boolean`
  - `filters?: { statuses?: string[], provinces?: string[], cities?: string[] }`

### GET `/api/medical/match/:recordId/stream`
- 说明：SSE 流式推送匹配进度与结果
- Query：`jobId=<jobId>&token=<jwt>`（支持 query token）
- 返回：`text/event-stream`

### GET `/api/medical/match/:recordId/status`
- 说明：查询当前匹配任务状态与累计结果

### GET `/api/medical/match/history/:recordId`
- 说明：获取某条病历的历史匹配记录

### POST `/api/medical/match/history/:recordId/restore`
- 说明：将历史记录恢复为当前展示结果

## 5. 试验数据（Trials）

所有 `/api/trials/*` 需要 `Authorization`。

- GET `/api/trials/cache`：试验缓存元信息与统计
- GET `/api/trials/locations`：地点统计（省/市）
- POST `/api/trials/refresh`：刷新缓存（需 `ALLOW_TRIAL_REFRESH=true`）

## 6. 健康与监控

- GET `/api/health`：服务健康（Mongo/Redis 状态）
- GET `/api/metrics`：Prometheus metrics
- GET `/api/medical/ocr/health`：OCR 服务健康

