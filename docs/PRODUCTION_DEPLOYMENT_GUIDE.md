# 生产环境部署指南

## 概述

本文档详细描述了临床试验匹配平台的数据持久化和回看功能的生产环境部署流程。该系统采用多层架构，支持本地存储、云端备份、版本控制和历史回看功能。

## 架构设计

### 核心组件

```
┌─────────────────────────────────────────────────────────────┐
│                    前端层 (Next.js)                        │
├─────────────────────────────────────────────────────────────┤
│  历史记录页面 • 版本对比 • 数据导出 • 存储统计 • 时间线视图     │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                   API网关层 (Express)                      │
├─────────────────────────────────────────────────────────────┤
│  认证授权 • 路由分发 • 限流控制 • 日志记录 • 监控指标         │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                   业务逻辑层                               │
├─────────────────────────────────────────────────────────────┤
│  HistoryController • FileStorageService • CloudStorage     │
│  VersionControl • DataExport • StorageStats               │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                   数据存储层                               │
├─────────────────────────────────────────────────────────────┤
│  MongoDB: FileMetadata • 版本历史 • 备份状态 • 访问统计     │
│  本地存储: 文件系统 • 目录结构 • 权限管理 • 完整性校验       │
│  云端存储: 阿里云OSS • 多地备份 • 加密存储 • 访问控制        │
└─────────────────────────────────────────────────────────────┘
```

## 部署前准备

### 1. 环境要求

- **Node.js**: ≥ 18.0.0
- **MongoDB**: ≥ 5.0.0
- **Redis**: ≥ 6.0.0 (可选，推荐用于生产)
- **阿里云OSS**: 用于云端备份
- **操作系统**: Linux/macOS (推荐 Ubuntu 20.04+)

### 2. 依赖安装

```bash
# 安装系统依赖
sudo apt-get update
sudo apt-get install -y build-essential python3 graphicsmagick

# 安装 Node.js (使用 nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 18
nvm use 18

# 安装 PM2 进程管理器
npm install -g pm2
```

### 3. 阿里云配置

#### OSS 存储桶配置

1. **创建存储桶**
```bash
# 使用阿里云CLI创建存储桶
aliyun oss mb oss://clinical-match-backups --region cn-hangzhou
```

2. **配置访问权限**
```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "oss:PutObject",
        "oss:GetObject",
        "oss:DeleteObject",
        "oss:ListObjects",
        "oss:GetObjectAcl",
        "oss:PutObjectAcl"
      ],
      "Resource": [
        "acs:oss:*:*:clinical-match-backups",
        "acs:oss:*:*:clinical-match-backups/*"
      ]
    }
  ]
}
```

3. **配置生命周期规则**
```bash
# 设置文件生命周期：标准存储30天，低频访问90天，归档存储1年
aliyun oss put-bucket-lifecycle --bucket clinical-match-backups \
  --lifecycle-configuration file://lifecycle-config.json
```

## 部署步骤

### 1. 代码部署

```bash
# 克隆代码仓库
git clone https://github.com/your-org/clinical-match.git
cd clinical-match

# 安装依赖
npm run install-all

# 配置环境变量
cp server/.env.example server/.env
# 编辑 server/.env 填入必要的配置
```

### 2. 数据库初始化

```bash
# 启动 MongoDB 服务
sudo systemctl start mongod

# 创建数据库和集合
mongo clinicalmatch --eval "
  db.createCollection('filemetadata');
  db.createCollection('patients');
  db.createCollection('users');
"

# 创建索引
mongo clinicalmatch --eval "
  db.filemetadata.createIndex({ userId: 1, status: 1, createdAt: -1 });
  db.filemetadata.createIndex({ patientId: 1, status: 1, createdAt: -1 });
  db.filemetadata.createIndex({ checksum: 1 });
  db.filemetadata.createIndex({ 'backupStatus.cloud': 1, 'backupStatus.lastBackup': 1 });
"
```

### 3. 配置文件设置

#### 服务器配置 (`server/.env`)

```bash
# 基础配置
PORT=5001
MONGODB_URI=mongodb://localhost:27017/clinicalmatch
JWT_SECRET=your-super-secure-jwt-secret

# 存储配置
STORAGE_BASE_PATH=/opt/clinical-match/uploads
MAX_FILE_SIZE=52428800

# 阿里云OSS配置
ALIBABA_OSS_REGION=oss-cn-hangzhou
ALIBABA_OSS_BUCKET=clinical-match-backups
ALIBABA_ACCESS_KEY_ID=your-access-key
ALIBABA_ACCESS_KEY_SECRET=your-secret-key

# Redis配置 (可选)
REDIS_URL=redis://localhost:6379

# 特征标志
FEATURE_USE_REFACTORED_SERVICES=true
FEATURE_ENABLE_HYBRID_MATCHING=true
```

#### Nginx 配置

```nginx
# /etc/nginx/sites-available/clinical-match
server {
    listen 80;
    server_name your-domain.com;

    # 前端静态文件
    location / {
        root /opt/clinical-match/client/build;
        try_files $uri $uri/ /index.html;
    }

    # API 代理
    location /api/ {
        proxy_pass http://localhost:5001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # 文件上传大小限制
        client_max_body_size 50M;
    }

    # 上传文件访问
    location /uploads/ {
        alias /opt/clinical-match/uploads/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

### 4. 系统服务配置

#### PM2 配置文件 (`ecosystem.config.js`)

```javascript
module.exports = {
  apps: [
    {
      name: 'clinical-match-server',
      script: 'server/index.js',
      cwd: '/opt/clinical-match',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 5001
      },
      error_file: '/var/log/clinical-match/server-error.log',
      out_file: '/var/log/clinical-match/server-out.log',
      log_file: '/var/log/clinical-match/server-combined.log',
      time: true
    },
    {
      name: 'clinical-match-worker',
      script: 'server/workers/index.js',
      cwd: '/opt/clinical-match',
      instances: 2,
      env: {
        NODE_ENV: 'production'
      },
      error_file: '/var/log/clinical-match/worker-error.log',
      out_file: '/var/log/clinical-match/worker-out.log',
      log_file: '/var/log/clinical-match/worker-combined.log',
      time: true
    }
  ]
};
```

#### Systemd 服务

```ini
# /etc/systemd/system/clinical-match.service
[Unit]
Description=Clinical Match Platform
After=network.target mongod.service

[Service]
Type=forking
User=clinical-match
WorkingDirectory=/opt/clinical-match
ExecStart=/usr/local/bin/pm2 start ecosystem.config.js --env production
ExecReload=/usr/local/bin/pm2 reload ecosystem.config.js --env production
ExecStop=/usr/local/bin/pm2 stop ecosystem.config.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### 5. 存储目录设置

```bash
# 创建存储目录
sudo mkdir -p /opt/clinical-match/uploads
sudo mkdir -p /opt/clinical-match/backups
sudo mkdir -p /opt/clinical-match/logs

# 设置权限
sudo chown -R clinical-match:clinical-match /opt/clinical-match
sudo chmod -R 755 /opt/clinical-match/uploads
sudo chmod -R 750 /opt/clinical-match/backups

# 创建回收站目录
mkdir -p /opt/clinical-match/uploads/.trash
mkdir -p /opt/clinical-match/uploads/.versions
```

### 6. 启动服务

```bash
# 启动应用
sudo systemctl enable clinical-match
sudo systemctl start clinical-match

# 检查状态
sudo systemctl status clinical-match
pm2 status

# 查看日志
pm2 logs clinical-match-server
pm2 logs clinical-match-worker
```

## 监控和告警

### 1. 健康检查

```bash
# 检查服务状态
curl -f http://localhost:5001/api/health || exit 1

# 检查数据库连接
mongo --eval "db.runCommand('ping')" clinicalmatch

# 检查存储空间
df -h /opt/clinical-match
```

### 2. 监控指标

| 指标类型 | 指标名称 | 告警阈值 | 说明 |
|---------|---------|---------|------|
| 系统指标 | CPU使用率 | > 80% | 持续5分钟 |
| 系统指标 | 内存使用率 | > 85% | 持续5分钟 |
| 系统指标 | 磁盘使用率 | > 90% | 立即告警 |
| 应用指标 | 请求响应时间 | > 2s | 持续1分钟 |
| 应用指标 | 错误率 | > 5% | 持续1分钟 |
| 业务指标 | 文件上传失败率 | > 10% | 持续5分钟 |
| 业务指标 | 云备份失败数 | > 5 | 每小时 |

### 3. 日志配置

```bash
# 配置日志轮转
sudo tee /etc/logrotate.d/clinical-match << EOF
/var/log/clinical-match/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 644 clinical-match clinical-match
    postrotate
        pm2 reloadLogs
    endscript
}
EOF
```

## 备份策略

### 1. 数据库备份

```bash
#!/bin/bash
# 数据库备份脚本
BACKUP_DIR="/opt/clinical-match/backups/db"
DATE=$(date +%Y%m%d_%H%M%S)

# 创建备份目录
mkdir -p $BACKUP_DIR

# 执行备份
mongodump --host localhost --port 27017 --db clinicalmatch \
  --out $BACKUP_DIR/$DATE

# 压缩备份
tar -czf $BACKUP_DIR/clinicalmatch_$DATE.tar.gz -C $BACKUP_DIR $DATE

# 删除原始备份目录
rm -rf $BACKUP_DIR/$DATE

# 清理旧备份 (保留30天)
find $BACKUP_DIR -name "clinicalmatch_*.tar.gz" -mtime +30 -delete
```

### 2. 文件备份

```bash
#!/bin/bash
# 文件备份脚本
BACKUP_DIR="/opt/clinical-match/backups/files"
DATE=$(date +%Y%m%d_%H%M%S)

# 创建备份目录
mkdir -p $BACKUP_DIR

# 同步上传到云端
aws s3 sync /opt/clinical-match/uploads \
  s3://clinical-match-backups/uploads/ \
  --delete

# 本地备份 (可选)
tar -czf $BACKUP_DIR/uploads_$DATE.tar.gz \
  -C /opt/clinical-match uploads

# 清理旧备份 (保留7天)
find $BACKUP_DIR -name "uploads_*.tar.gz" -mtime +7 -delete
```

### 3. 灾难恢复

```bash
#!/bin/bash
# 灾难恢复脚本

# 恢复数据库
mongorestore --host localhost --port 27017 \
  --db clinicalmatch \
  /opt/clinical-match/backups/db/latest/

# 恢复文件
aws s3 sync s3://clinical-match-backups/uploads/ \
  /opt/clinical-match/uploads/

# 重新索引
mongo clinicalmatch --eval "
  db.filemetadata.reIndex();
  db.patients.reIndex();
  db.users.reIndex();
"
```

## 安全加固

### 1. 网络安全

```bash
# 配置防火墙
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

# 配置 fail2ban
sudo apt-get install fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

### 2. 数据加密

```bash
# 生成加密密钥
openssl rand -base64 32 > /opt/clinical-match/secrets/encryption.key
chmod 600 /opt/clinical-match/secrets/encryption.key

# 配置 SSL/TLS
sudo certbot --nginx -d your-domain.com
```

### 3. 访问控制

```bash
# 限制数据库访问
# 编辑 /etc/mongod.conf
security:
  authorization: enabled
  keyFile: /etc/mongodb-keyfile

# 创建管理用户
mongo admin --eval "
  db.createUser({
    user: 'admin',
    pwd: 'your-admin-password',
    roles: [{ role: 'userAdminAnyDatabase', db: 'admin' }]
  });
"
```

## 性能优化

### 1. 数据库优化

```javascript
// 创建复合索引
db.filemetadata.createIndex({
  userId: 1,
  patientId: 1,
  createdAt: -1
});

// 启用 TTL 索引自动清理
db.filemetadata.createIndex({
  "backupStatus.lastBackup": 1
}, {
  expireAfterSeconds: 60 * 60 * 24 * 365 // 1年
});
```

### 2. 存储优化

```bash
# 配置 SSD 缓存
echo 'vm.vfs_cache_pressure=50' >> /etc/sysctl.conf
echo 'vm.swappiness=10' >> /etc/sysctl.conf

# 优化文件系统挂载选项
# 编辑 /etc/fstab
UUID=xxx /opt/clinical-match ext4 defaults,noatime,nodiratime,nobarrier 0 2
```

### 3. 应用优化

```bash
# 配置 Node.js 参数
export NODE_OPTIONS="--max-old-space-size=4096"
export UV_THREADPOOL_SIZE=128
```

## 故障排查

### 常见问题和解决方案

#### 1. 文件上传失败

**症状**: 上传文件时返回 413 错误

**解决方案**:
```bash
# 检查 Nginx 配置
client_max_body_size 50M;

# 检查应用配置
MAX_FILE_SIZE=52428800
```

#### 2. 云备份失败

**症状**: 备份状态显示为失败

**解决方案**:
```bash
# 检查 OSS 配置
aliyun oss ls oss://clinical-match-backups/

# 检查网络连接
curl -I https://oss-cn-hangzhou.aliyuncs.com

# 检查权限
aliyun sts get-caller-identity
```

#### 3. 数据库连接超时

**症状**: 应用无法连接数据库

**解决方案**:
```bash
# 检查 MongoDB 状态
sudo systemctl status mongod

# 检查连接数
mongo --eval "db.serverStatus().connections"

# 调整连接池大小
# 编辑服务器配置
MONGODB_MAX_POOL_SIZE=100
```

## 维护和更新

### 1. 定期维护任务

```bash
#!/bin/bash
# 每周维护脚本

# 清理临时文件
find /tmp -name "clinical-match-*" -mtime +7 -delete

# 优化数据库
mongo clinicalmatch --eval "db.runCommand({compact: 'filemetadata'})"

# 检查磁盘空间
df -h /opt/clinical-match

# 更新 SSL 证书
certbot renew --quiet
```

### 2. 版本更新流程

```bash
# 1. 备份当前版本
sudo systemctl stop clinical-match
cp -r /opt/clinical-match /opt/clinical-match.backup

# 2. 拉取新版本
cd /opt/clinical-match
git pull origin main

# 3. 安装依赖
npm run install-all

# 4. 运行数据库迁移
node server/scripts/migrateFileStorage.js

# 5. 重启服务
sudo systemctl start clinical-match

# 6. 验证部署
curl -f http://localhost:5001/api/health
```

## 性能基准

### 预期性能指标

| 操作类型 | 响应时间 | 并发量 | 备注 |
|---------|---------|--------|------|
| 文件上传 | < 5s | 100 | 50MB文件 |
| 历史查询 | < 200ms | 500 | 分页查询 |
| 版本对比 | < 1s | 50 | 小文件对比 |
| 数据导出 | < 10s | 10 | 1000条记录 |
| 云备份 | < 30s | 20 | 异步处理 |

### 扩展性规划

- **存储容量**: 支持 10TB 本地存储 + 100TB 云端存储
- **用户数量**: 支持 10,000 注册用户，1,000 并发用户
- **文件数量**: 支持 1,000,000 个文件，平均文件大小 5MB
- **版本历史**: 每个文件支持 100 个版本

## 总结

本部署指南提供了完整的生产环境配置流程，包括系统架构、部署步骤、监控告警、备份策略、安全加固和性能优化。通过遵循这些最佳实践，可以确保临床试验匹配平台的数据持久化和回看功能在生产环境中稳定、安全、高效地运行。

系统采用多层存储架构，结合本地存储的性能优势和云端备份的可靠性，为用户提供完整的数据保护和历史追溯能力。版本控制机制确保数据的完整性和可追溯性，而丰富的回看界面则为用户提供了直观的历史数据管理体验。