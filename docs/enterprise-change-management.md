# 企业级变更管理模式（Enterprise Change Management Playbook）

> 目标：在保证交付速度的同时，建立可审计、可回滚、可度量的变更流程，确保 Clinical Trial Matching 平台在多环境、多团队协作下安全迭代。

---

## 1. 组织与职责

| 角色 | 主要职责 |
| --- | --- |
| **产品负责人 (PO)** | 定义需求优先级、验收范围与业务影响 |
| **技术负责人 (TL)** | 设计评审、风险评估、技术决策 |
| **开发工程师 (DEV)** | 完成实现、单元测试、代码自检 |
| **测试/质量负责人 (QA)** | 制定测试计划、执行自动化与手工测试、给出放行意见 |
| **运维负责人 (SRE/DevOps)** | 维护 CI/CD、监控、回滚方案、发布窗口协调 |
| **安全负责人 (Sec)** | 合规审查、依赖扫描、渗透测试（必要时） |
| **变更审批委员会 (CAB)** | 对高风险/跨部门变更做最终审批 |

> 建议建立 RACI 表（Responsible / Accountable / Consulted / Informed）管理复杂变更。

---

## 2. 环境与分支策略

- **Git 主干 (main)**：始终保持可部署（通过全部质量门禁）。
- **发布分支 (release/YYMMDD)**：关键版本封版后创建，用于回归与热补丁。
- **特性分支 (feature/\*)**：以需求/工单号为前缀，确保变更来源可追溯（例：`feature/PLAT-123-upload-test-data`）。
- **补丁分支 (hotfix/\*)**：紧急修复从最新发布分支切出，部署后回合并主干。

环境流转示意：
1. **Dev/Local**：个人环境、`deploy/start_local_services.sh` 或 `./deploy/run_all.sh`。
2. **Integration/Staging**：自动化部署，跑端到端测试、数据脱敏同步。
3. **Pre-Prod**：模拟生产配置，数据有限制，做灰度或演练。
4. **Production**：真实用户访问，只有 CAB 批准的变更才可上线。

---

## 3. 变更生命周期（Change Lifecycle）

1. **需求立项**
   - 在工单系统（如 Jira/Azure DevOps）记录需求，标明业务影响、验收标准。
   - 若为紧急修复，记录事故编号和影响范围。

2. **方案与风险评估**
   - TL 组织设计评审，输出架构草图、依赖分析、回滚策略。
   - 标记变更等级：低、中、高风险；决定是否需要 CAB 审批。

3. **开发实现**
   - 在特性分支上开发，遵循编码规范与静态检查。
   - 本地运行必要脚本（如 `npm run lint`, `npm run test`, `./deploy/start_local_services.sh`）验证。

4. **代码审查**
   - PR 模板强制填写：需求链接、变更摘要、验证步骤、风险。
   - 至少 1 名 TL + 1 名同级工程师审核；涉及安全或数据的变更需安全负责人参与。

5. **自动化质量门禁**
   - CI 流水线任务：依赖安装、单元测试、集成测试、Lint/Type Check、构建、容器镜像扫描、SAST/DAST。
   - 未通过门禁不能合并；覆盖率下降需给出豁免说明。

6. **预发布验证**
   - 自动部署到 Staging/Pre-Prod，执行端到端脚本（健康检查、`curl` 测试、UI 回归）。
   - QA 完成手工探索测试，生成测试报告与放行意见。

7. **审批与发布**
   - 高风险变更提交 CAB，附带：测试报告、回滚预案、上线窗口。
   - 运维负责人在维护窗口执行部署脚本（例如 `./deploy/run_all.sh` + relay 同步），记录发布日志。

8. **上线后监控**
   - 使用 PM2、监控系统（APM/日志/指标）观察核心指标（请求成功率、响应时间、错误率）。
   - 设置发布后观察期（例如 1 小时）；若触发 SLO 告警，按预案回滚。

9. **变更归档**
   - 更新 Release Notes（版本号、主要功能、BUG 修复、已知问题、回滚记录）。
   - 对事故或重大缺陷进行事后复盘（Postmortem），记录原因与改进项。

---

## 4. 工具与流程集成建议

- **Issue Management**：Jira/Linear——配置 Workflow（Backlog → In Progress → In Review → In QA → Ready for Release → Done）。
- **版本控制**：GitHub/GitLab，启用受保护分支、强制代码审查、签名提交。
- **CI/CD**：GitHub Actions/GitLab CI + ArgoCD/Spinnaker 等，实现：
  - 构建镜像、生成工件；
  - 部署脚本套件（现有 `deploy/run_all.sh`、`deploy/relay/sync_and_setup.sh`）；
  - 自动健康检查 (`deploy/healthcheck.sh`)。
- **质量平台**：SonarQube、Snyk、OWASP Zap 集成到流水线。
- **监控告警**：Prometheus + Grafana / Datadog；日志集中化（ELK/Splunk）。
- **文档管理**：Confluence/Notion，同步存档变更说明、架构文档。

---

## 5. 模板与清单（建议保存在仓库或 Wiki）

### 5.1 变更请求模板（Change Request）
```
* 变更标题：
* 需求/工单链接：
* 变更类型：功能 / 修复 / 架构 / 安全 / 紧急
* 影响系统：前端 / 后端 API / OCR / Relay / 数据库 / 其他
* 风险等级：低 / 中 / 高
* 计划发布时间窗口：
* 回滚策略：
* 测试覆盖：自动化（通过项）+ 手工验证摘要
* 审批人：
```

### 5.2 发布检查清单（Release Checklist）
- [ ] 代码合并至 `main`/`release` 分支
- [ ] CI 全部通过（流水线编号、时间）
- [ ] Staging/Pre-Prod 验证通过
- [ ] Release Notes 已更新并通知相关方
- [ ] 监控仪表盘已更新发布基线
- [ ] 回滚脚本/备份已准备
- [ ] CAB 审批记录（如适用）

### 5.3 回滚流程示例
1. 判断是否触发回滚条件（SLO 告警、数据损坏、功能不可用等）。
2. 通知 On-call & CAB，冻结当前发布。
3. 采取以下之一：
   - `pm2 deploy` 回滚到上一版本；
   - 重新同步上一标签 (`git checkout tags/vX.Y.Z && ./deploy/run_all.sh`)；
   - 恢复数据库/配置备份。
4. 验证服务恢复，记录时间线与影响范围。
5. 组织 Postmortem，明确根因与改进项。

---

## 6. 与现有仓库流程的对齐建议

1. **脚本文档化**：将 `./deploy/run_all.sh`、`deploy/relay/sync_and_setup.sh` 等脚本的使用说明整合进变更流程，确保发布有标准操作手册。
2. **自动验证**：在 CI 中连带执行关键健康检查（OCR/Medical API `curl`），模拟 `deploy/healthcheck.sh`。
3. **环境变量管理**：禁止直接提交 `.env`，使用集中密钥管理工具（Vault/1Password/Secret Manager）和模板文件（`.env.example`）。
4. **日志与档案**：把 `docs/cleanup-candidates.md` 中标记的运行时文件排除出 Git，避免发布包污染。
5. **培训与演练**：每季度对关键流程（回滚、灾备、权限提升）进行演练，确保团队熟练。

---

## 7. 持续改进

- 定期（每月/每季度）回顾发布指标：失败率、回滚次数、平均审查时长。
- 收集团队反馈，优化流程瓶颈，例如自动化更多测试或统一配置管理。
- 对新增系统（如 Relay、autossh 隧道）进行安全与可靠性评估，必要时引入基础设施即代码（Terraform/Ansible）纳入变更控制。

> 通过以上流程，可让项目迭代具备“可追踪 → 可验证 → 可回滚”的企业级品质，支撑团队在合规与高可靠要求下持续交付。

