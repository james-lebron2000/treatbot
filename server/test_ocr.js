const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

async function testOCR() {
  try {
    console.log('🔍 测试阿里云OCR服务...\n');
    
    // 1. 首先登录获取token
    console.log('1. 登录获取JWT Token...');
    const loginResponse = await axios.post('http://localhost:5001/api/auth/login', {
      email: 'test@example.com',
      password: 'password123'
    });
    
    const token = loginResponse.data.token;
    console.log('✅ 登录成功，获得token\n');
    
    // 2. 测试OCR健康检查
    console.log('2. 检查OCR服务健康状态...');
    const healthResponse = await axios.get('http://localhost:5001/api/medical/ocr/health');
    console.log(`状态: ${healthResponse.data.status}`);
    console.log(`消息: ${healthResponse.data.message}`);
    console.log(`凭据配置: ${healthResponse.data.configuration.credentialsConfigured ? '✅' : '❌'}\n`);
    
    // 3. 上传测试图片
    console.log('3. 上传test.jpg进行OCR识别...');
    const testImagePath = path.join(__dirname, '../test.jpg');
    
    if (!fs.existsSync(testImagePath)) {
      throw new Error('test.jpg文件不存在');
    }
    
    const formData = new FormData();
    formData.append('file', fs.createReadStream(testImagePath));
    
    const uploadResponse = await axios.post(
      'http://localhost:5001/api/medical/upload',
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          'Authorization': `Bearer ${token}`
        }
      }
    );
    
    console.log('📊 OCR识别结果:');
    console.log(`- 服务商: ${uploadResponse.data.ocrMetadata.provider}`);
    console.log(`- 置信度: ${uploadResponse.data.ocrMetadata.confidence}%`);
    console.log(`- 处理时间: ${uploadResponse.data.ocrMetadata.processingTime}ms`);
    console.log(`- 模板类型: ${uploadResponse.data.ocrMetadata.templateType}`);
    console.log(`- 页面数量: ${uploadResponse.data.ocrMetadata.pageCount}\n`);
    
    console.log('📝 提取的文本内容:');
    console.log('-------------------');
    console.log(uploadResponse.data.extractedText);
    console.log('-------------------\n');
    
    // 4. 解析医疗文本
    console.log('4. 解析医疗文本数据...');
    const parseResponse = await axios.post(
      'http://localhost:5001/api/medical/parse',
      {
        text: uploadResponse.data.extractedText,
        ocrMetadata: uploadResponse.data.ocrMetadata
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    
    console.log('🏥 解析后的结构化数据:');
    console.log(JSON.stringify(parseResponse.data.structuredData, null, 2));
    console.log(`\n✅ 测试完成！记录ID: ${parseResponse.data.recordId}`);
    
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    if (error.response?.data) {
      console.error('错误详情:', error.response.data);
    }
  }
}

testOCR();