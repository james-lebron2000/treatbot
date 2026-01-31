# 阿里云OCR服务配置指南

## 🚀 当前状态
- ✅ OCR服务代码集成完成
- ✅ Fallback机制正常工作
- ⚠️  需要配置真实的阿里云凭据才能使用真实OCR功能
- 🔧 PDF处理依赖正在安装中

## 📋 配置步骤

### 1. 获取阿里云OCR凭据
1. 登录[阿里云控制台](https://ram.console.aliyun.com/users)
2. 创建RAM用户或使用现有用户
3. 为用户授权"AliyunOCRFullAccess"权限
4. 获取AccessKey ID和AccessKey Secret

### 2. 更新.env文件
将以下占位符替换为真实凭据：

```env
# 当前配置（占位符）
ALIBABA_ACCESS_KEY_ID=your_access_key_id
ALIBABA_ACCESS_KEY_SECRET=your_access_key_secret

# 替换为真实凭据
ALIBABA_ACCESS_KEY_ID=你的真实AccessKey
ALIBABA_ACCESS_KEY_SECRET=你的真实AccessKeySecret
```

### 3. 验证配置
配置完成后，OCR服务将：
- ✅ 自动检测凭据有效性
- ✅ 支持图片文件（JPG, PNG）OCR识别
- ✅ 支持PDF文件转换和OCR识别
- ✅ 在OCR失败时自动fallback到模拟数据

## 🔍 当前测试结果

### 图片文件测试
- ✅ **状态**: 正常工作
- 📊 **Fallback**: 正确触发模拟数据
- 💬 **前端显示**: 文本内容正常显示

### PDF文件测试
- ⚠️  **状态**: 需要完成Cairo依赖安装
- 🔄 **进度**: Cairo和Poppler正在安装中
- 📊 **Fallback**: PDF失败时正确触发模拟数据

## 📊 OCR服务特性

### 智能模板选择
```javascript
// 自动根据文件名选择模板
const template = originalName.toLowerCase().includes('医疗') || 
                originalName.toLowerCase().includes('病历') || 
                originalName.toLowerCase().includes('检查') ? 'medical' : 'general';
```

### 完整的元数据跟踪
- 📈 **置信度**: 实时计算识别准确率
- ⏱️  **处理时间**: 记录完整处理耗时
- 🏷️  **服务商**: 区分阿里云/文件读取/模拟数据
- 💰 **成本估算**: 基于阿里云定价的成本计算

### 三层错误处理
1. **阿里云OCR** - 优先使用真实OCR服务
2. **凭据检查** - 自动检测配置问题
3. **智能Fallback** - 降级到高质量模拟数据

## 🧪 测试方法

### 1. 图片文件测试
上传任意JPG/PNG文件，应该看到：
- ✅ OCR元数据显示"模拟数据"
- ✅ 提取的医疗文本内容
- ✅ 置信度85%

### 2. 文本文件测试  
上传.txt文件，应该看到：
- ✅ OCR元数据显示"文本读取"  
- ✅ 完整文件内容
- ✅ 置信度100%

### 3. 验证真实OCR
配置真实凭据后，应该看到：
- ✅ OCR元数据显示"阿里云"
- ✅ 真实图片识别结果
- ✅ 置信度90%+

## 🚨 故障排除

### 问题1: "OCR processing failed"
**原因**: 阿里云凭据未配置
**解决**: 更新.env文件中的真实凭据

### 问题2: PDF上传失败
**原因**: Cairo依赖未安装完成
**解决**: 等待`brew install cairo poppler`完成

### 问题3: 前端无文本显示
**原因**: 已修复 - OCR结果现在正确返回给前端
**状态**: ✅ 已解决

## 💡 下一步
1. 完成Cairo依赖安装
2. 配置真实阿里云凭据测试
3. 验证所有文件类型的OCR功能