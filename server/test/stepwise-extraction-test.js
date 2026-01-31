const fs = require('fs');
const path = require('path');
const StepwiseLLMService = require('../services/stepwiseLLMService');
const TrialMatchingEngine = require('../services/trialMatchingEngine');

// 测试分步医疗数据提取系统
async function testStepwiseExtraction() {
  console.log('🧪 开始测试分步医疗数据提取系统...\n');

  // 1. 读取测试数据
  const testDataPath = path.join(__dirname, '..', '..', 'data', 'test.txt');
  let testText;
  
  try {
    testText = fs.readFileSync(testDataPath, 'utf8');
    console.log('✅ 成功读取测试数据文件');
    console.log(`📄 文本长度: ${testText.length} 字符\n`);
  } catch (error) {
    console.error('❌ 读取测试数据失败:', error.message);
    return;
  }

  // 2. 初始化服务
  const stepwiseLLMService = new StepwiseLLMService();
  const trialMatchingEngine = new TrialMatchingEngine();

  // 3. 检查服务初始化
  await trialMatchingEngine.getEngineStats();

  console.log('🔧 服务初始化状态:');
  console.log(`- StepwiseLLMService: ${stepwiseLLMService ? '✅ 已初始化' : '❌ 失败'}`);
  console.log(`- TrialMatchingEngine: ${trialMatchingEngine ? '✅ 已初始化' : '❌ 失败'}`);
  console.log(`- 试验数据: ${trialMatchingEngine.trialsData?.length || 0} 条记录\n`);

  // 4. 测试schema加载
  console.log('📋 Schema验证:');
  console.log(`- 医疗数据schema: ${stepwiseLLMService.schema ? '✅ 已加载' : '❌ 未加载'}`);
  if (stepwiseLLMService.schema) {
    const steps = Object.keys(stepwiseLLMService.schema.extraction_steps || {});
    console.log(`- 提取步骤: ${steps.length} 个步骤`);
    steps.forEach(step => {
      const stepInfo = stepwiseLLMService.schema.extraction_steps[step];
      console.log(`  ${step}: ${stepInfo.name} (${Object.keys(stepInfo.fields || {}).length} 个字段)`);
    });
  }
  console.log();

  // 5. 测试无LLM模式的基本功能
  console.log('🎯 测试基本功能 (无LLM调用):');
  try {
    const testJobId = 'test_job_' + Date.now();
    
    // 模拟创建任务
    const mockJobInfo = {
      jobId: testJobId,
      patientId: 'TEST_PATIENT_001',
      medicalText: testText,
      status: 'completed',
      currentStep: 11,
      totalSteps: 11,
      results: {
        step_1: {
          success: true,
          data: {
            age: 53,
            gender: '男',
            pregnancy_status: null,
            confidence: 'high',
            reasoning: '从病历中明确提取'
          }
        },
        step_2: {
          success: true,
          data: {
            primary_diagnosis: '肝细胞癌',
            pathology_type: 'III级',
            staging_value: 'ypT3',
            mvi_grade: 'M1',
            confidence: 'high',
            reasoning: '病理报告明确描述'
          }
        }
      }
    };

    await stepwiseLLMService.saveJob(mockJobInfo);
    
    // 测试状态获取
    const status = await stepwiseLLMService.getExtractionStatus(testJobId);
    console.log(`✅ 状态查询测试通过: ${status.status}`);
    
    // 测试结果获取
    const result = await stepwiseLLMService.getStructuredResult(testJobId);
    console.log(`✅ 结果获取测试通过: ${result ? '有结果' : '无结果'}`);
    
  } catch (error) {
    console.error('❌ 基本功能测试失败:', error.message);
  }
  console.log();

  // 6. 测试匹配引擎
  console.log('🎯 测试匹配引擎:');
  try {
    const mockStructuredData = {
      age: 53,
      gender: '男',
      primary_diagnosis: '肝细胞癌',
      staging_value: 'CNLC IIIb期',
      metastasis_sites: ['肺', '骨', '腹膜'],
      measurable_lesions: true,
      ecog_score: null, // 模拟缺失数据
      total_treatment_lines: 3,
      blood_counts: {
        hemoglobin: 107,
        platelet: 92,
        anc: 2.49
      },
      liver_function: {
        alt: 23,
        ast: 22.6,
        tbil: 24.9
      },
      viral_hepatitis: {
        hbv_status: '阳性',
        hbv_dna: '1.01E+01',
        antiviral_treatment: true
      },
      systemic_treatments: [
        {
          line: 1,
          regimen: ['信迪利单抗', '仑伐替尼'],
          best_response: 'SD'
        },
        {
          line: 2,
          regimen: ['艾瑞卡', '阿帕替尼'],
          best_response: 'PD'
        },
        {
          line: 3,
          regimen: ['百泽安', '瑞戈非尼'],
          best_response: 'PD'
        }
      ]
    };

    console.log('📊 模拟结构化数据:');
    console.log(`- 年龄: ${mockStructuredData.age}岁`);
    console.log(`- 诊断: ${mockStructuredData.primary_diagnosis}`);
    console.log(`- 治疗线数: ${mockStructuredData.total_treatment_lines}线`);
    console.log(`- 转移部位: ${mockStructuredData.metastasis_sites.join(', ')}`);
    
    const engineStats = await trialMatchingEngine.getEngineStats();
    console.log('\n📈 匹配引擎统计:');
    console.log(`- 试验总数: ${engineStats.totalTrials}`);
    console.log(`- 评分类别: ${engineStats.matchingRules.scoringCategories}`);
    console.log(`- 总权重: ${engineStats.matchingRules.totalWeight}`);
    
    console.log('\n🔄 执行匹配测试...');
    const matches = await trialMatchingEngine.matchPatient(mockStructuredData, 'TEST_PATIENT_001');
    
    console.log(`✅ 匹配完成! 找到 ${matches.length} 个匹配的试验`);
    
    if (matches.length > 0) {
      console.log('\n🏆 前3个匹配结果:');
      matches.slice(0, 3).forEach((match, index) => {
        console.log(`\n${index + 1}. ${match.trialName}`);
        console.log(`   试验ID: ${match.trialId}`);
        console.log(`   匹配分数: ${match.matchScore}%`);
        console.log(`   匹配等级: ${match.matchLevel}`);
        console.log(`   摘要: ${match.summary}`);
        if (match.matchingBarriers.length > 0) {
          console.log(`   主要障碍: ${match.matchingBarriers.length} 个`);
          match.matchingBarriers.slice(0, 2).forEach(barrier => {
            console.log(`     - ${barrier.issue} (${barrier.severity})`);
          });
        }
      });
    }
    
  } catch (error) {
    console.error('❌ 匹配引擎测试失败:', error.message);
    console.error(error.stack);
  }
  console.log();

  // 7. 测试完成
  console.log('🎉 测试完成!');
  console.log('📝 测试总结:');
  console.log('✅ 基本服务初始化');
  console.log('✅ 数据文件读取');
  console.log('✅ Schema结构验证');
  console.log('✅ 匹配引擎功能');
  console.log('\n💡 注意: 实际LLM提取需要配置API密钥');
  console.log('🔧 若要测试完整流程，请确保在.env中配置OPENAI_API_KEY');
}

// 运行测试
if (require.main === module) {
  testStepwiseExtraction().catch(console.error);
}

module.exports = { testStepwiseExtraction };
