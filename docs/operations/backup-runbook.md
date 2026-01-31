# 本地与远程备份运行手册

> 目标：确保 Clinical Trial Matching 平台的数据库与上传文件拥有至少 30 天的可恢复副本，并支持一键执行与自动调度。

---

## 1. 备份策略总览

| 数据类别 | 存储位置 | 周期 | 工具 | 备注 |
| --- | --- | --- | --- | --- |
| MongoDB 数据库 | `backups/mongo/<YYYY-MM-DD>` | 每日 | `mongodump` | 保留最近 30 天 |
| 上传文件（包含 OCR 原件） | `backups/uploads/` | 每日 | `rsync` | 与 `uploads/` 目录镜像 |
| 远端副本（可选） | 自定义 `OFFSITE_RSYNC_TARGET` | 每日 | `rsync -az` | 建议指向 SSH/S3 网关 |

---

## 2. 一键备份脚本

仓库新增脚本 `scripts/backup/run_local_backup.sh`，默认执行以下步骤：

1. `mongodump --uri "$MONGO_URI" --out backups/mongo/<date>`
2. 清理 30 天前的旧备份目录
3. `rsync -a --delete uploads/ backups/uploads/`
4. 若设置 `OFFSITE_RSYNC_TARGET`，额外同步到远程目标

### 运行方式

```bash
chmod +x scripts/backup/run_local_backup.sh

# 手动执行（示例）
MONGO_URI="mongodb://localhost:27017/clinicalmatch" \
BACKUP_ROOT="/opt/clinical-match/backups" \
UPLOADS_PATH="/opt/clinical-match/uploads" \
OFFSITE_RSYNC_TARGET="user@backup-host:/data/clinical-match" \
./scripts/backup/run_local_backup.sh
```

脚本默认在仓库根目录下创建 `backups/`，可通过环境变量覆盖。

---

## 3. 自动化调度

### macOS / Linux（crontab）

```bash
crontab -e
# 每日凌晨 02:15 运行，并将日志写入 /var/log/clinical-match-backup.log
15 2 * * * cd /Users/<user>/trial-match && \
  MONGO_URI="mongodb://localhost:27017/clinicalmatch" \
  BACKUP_ROOT="/Users/<user>/trial-match/backups" \
  ./scripts/backup/run_local_backup.sh >> /var/log/clinical-match-backup.log 2>&1
```

### systemd 定时任务（Ubuntu/Vultr 服务器示例）

1. 创建服务单元 `/etc/systemd/system/clinical-match-backup.service`
   ```ini
   [Unit]
   Description=Clinical Match Daily Backup
   After=network.target

   [Service]
   Type=oneshot
   WorkingDirectory=/opt/trial-match
   Environment="MONGO_URI=mongodb://127.0.0.1:27017/clinicalmatch"
   Environment="BACKUP_ROOT=/opt/backups/clinical-match"
   Environment="UPLOADS_PATH=/opt/trial-match/uploads"
   ExecStart=/bin/bash /opt/trial-match/scripts/backup/run_local_backup.sh
   ```

2. 创建定时器 `/etc/systemd/system/clinical-match-backup.timer`
   ```ini
   [Unit]
   Description=Run Clinical Match backup daily

   [Timer]
   OnCalendar=*-*-* 02:15:00
   Persistent=true

   [Install]
   WantedBy=timers.target
   ```

3. 启动
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now clinical-match-backup.timer
   sudo systemctl status clinical-match-backup.timer
   ```

---

## 4. 恢复演练（建议每季度至少一次）

### 恢复数据库

```bash
# 假设需要恢复 2025-10-10 的快照
mongorestore --drop --uri "mongodb://localhost:27017/clinicalmatch" \
  backups/mongo/2025-10-10
```

### 恢复上传文件

```bash
rsync -a backups/uploads/ /opt/trial-match/uploads/
```

恢复后需重启本地/生产服务以加载最新数据：

```bash
./deploy/run_all.sh        # 本地
PM2_HOME=... pm2 restart trial-match-*   # 服务器
```

---

## 5. 运行状态检查

- 备份完成后检查日志 `/var/log/clinical-match-backup.log` 或 `journalctl -u clinical-match-backup.service`.
- 使用 `ls backups/mongo` / `ls backups/uploads` 验证日期更新。
- 远端复制可通过 `rsync --dry-run` 验证差异。

---

## 6. 迁移脚本（一次性回填）

在启用新文件存储前，请运行 `node server/scripts/migrateFileStorage.js` 回填既有文件元数据。脚本会：

1. 扫描 `server/uploads` 旧文件；
2. 建立 `FileMetadata` 记录及校验和；
3. 为未备份文件标记 `backupStatus.cloud = false`，供后续备份任务识别。

运行前确保：

- 已配置 `MONGODB_URI` / `.env`；
- 服务器磁盘空间足够（脚本不会移动文件，仅创建元数据）。

```bash
NODE_ENV=production node server/scripts/migrateFileStorage.js
```

---

## 7. 常见问题

- **`mongodump command not found`**：`brew install mongodb-database-tools` 或 `apt install mongodb-database-tools`.
- **备份体积过大**：调整 `RETENTION_DAYS` 或将 `backups/` 迁移到大容量磁盘。
- **远程同步失败**：检查 `OFFSITE_RSYNC_TARGET` 权限与网络；必要时改用 `scp` 或对象存储 SDK。

> 完成以上配置后，即可通过 Cron/systemd 自动化每日备份，并具备明确的恢复流程与审计轨迹。

