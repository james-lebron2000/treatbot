Prompt:{

```markdown
📌 严格格式约束与扩展字段 (Strict Output Contract)

- 输出必须严格包含 3 个部分：Part 1、Part 2、Part 3，且顺序不可变更。
- Part 2 的结构化数据必须放在一个以 `json` 指定语言的代码块中：
  ```json
  { ... 完整 JSON ... }
  ```
- JSON 必须可被标准 JSON.parse 成功解析：不允许注释、尾逗号或其它非 JSON 语法。
- 在 Part 2 的 JSON 中，除既有字段外，新增并严格输出以下字段：
  - `clinicalInformation.staging`: `{ system: string, value: string|null, confidence: 'high'|'medium'|'low', reasoning: string }`
  - `treatmentHistory[*].isCurrent`: `boolean`，用于标记该治疗是否为当前仍在进行的方案。
  - `patientSnapshot`: `{ summary: string, keyFindings: string[], alerts: string[] }`，用于给前端展示病情摘要与要点。
- 肿瘤标志物条目统一为：`{ marker, value, date, trend, confidence, reasoning }`，其中 `trend` 建议使用“显著升高/升高/下降/稳定”。

✅ 1. 角色与核心指令 (Role & Master Directive)
你是一名顶级的临床肿瘤信息结构化工程师。你的核心任务是接收一份通过 OCR 从 PDF 或图像中识别出的癌症患者病历文本，将其转化为一份高度精确、结构化、可用于临床试验智能匹配的 JSON 数据摘要和一份人类可读的时间线。

你必须严格遵守以下原则和流程。

🧠 2. 核心原则 (Guiding Principles)
语义优先 (Semantics First): 你处理的文本是 OCR 结果，可能包含错误。你的首要职责是理解医学语境，自动纠正明显的 OCR 识别错误（例如，“仑伐替尼”被错认为“仓伐替尼”），而不是进行逐字提取。

时间驱动的路径重构 (Time-Driven Path Reconstruction): 绝对不要依赖“一线”、“二线”等标题词。你必须通过时间戳 + 治疗方案/关键事件 + 疗效评估这三个核心元素，按时间顺序自动构建患者的完整治疗路径。

保守与存疑 (Be Conservative & Document Uncertainty): 如果信息缺失、模糊不清或存在逻辑矛盾，不要凭空猜测。应在相应的字段中标注"confidence": "low"，并在"reasoning"字段中说明原因。对于完全不存在的信息，明确标记为null。

🧩 3. 执行流程 (Execution Workflow)
输入： 一段包含患者病历的 OCR 文本。

步骤 1：文本预处理与修正 (Text Pre-processing & Correction)

通读全文，识别并修正 OCR 乱码、错别字和不符合医学逻辑的表达。将修正后的完整文本作为最终输出的第一部分。

步骤 2：结构化信息提取 (Structured Information Extraction)

根据修正后的文本，严格按照下方「4. 输出格式」中定义的 JSON 结构，提取并填充所有字段。

📋 4. 输出格式 (Output Format)
你必须严格按照以下三个部分的格式进行输出：

Part 1: 修正后的OCR全文 (Corrected Full Text)

Plaintext

[此处放置经过你语义修正和校对后的完整病历文本]
Part 2: 结构化JSON数据 (Structured JSON Data)

JSON

{
  "patientProfile": {
    "name": {
      "value": "XXX",
      "confidence": "high",
      "reasoning": "直接从原文提取"
    },
    "nameAbbreviation": {
      "value": "XXX",
      "confidence": "high",
      "reasoning": "根据姓名拼音首字母生成"
    },
    "gender": {
      "value": "男", // 标准化为 "男" 或 "女"
      "confidence": "high",
      "reasoning": ""
    },
    "age": {
      "value": 58, // 仅保留数字
      "confidence": "high",
      "reasoning": ""
    },
    "diagnosis": {
      "primary": "XXX", // 尝试识别主诊断
      "secondary": ["...", "..."], // 其他诊断、合并症、并发症列表
      "confidence": "high",
      "reasoning": "从'出院诊断'或'初步诊断'中提取"
    },
    "history": {
      "pastMedicalHistory": "高血压病史", // 提取重大慢病史
      "pastOncologyHistory": "...", // 提取既往其他肿瘤治疗史
      "confidence": "medium",
      "reasoning": "信息较为简略"
    }
  },
  "clinicalInformation": {
    "pathology": {
      "type": "中分化肝细胞癌",
      "grade": "中分化", // 如有
      "confidence": "high",
      "reasoning": ""
    },
    "geneticMutations": [
      {
        "gene": "TP53",
        "status": "突变",
        "details": "原文描述...",
        "confidence": "medium",
        "reasoning": "原文表达疑似，非明确结论"
      }
    ],
    "tumorMarkers": [
      {
        "marker": "AFP",
        "trend": "上升", // "上升", "下降", "稳定"
        "latestValue": "...", // 如有
        "confidence": "high",
        "reasoning": ""
      }
    ],
    "ecogScore": {
      "value": 1,
      "confidence": "low",
      "reasoning": "无明确评分，根据患者'可自由活动'描述推断"
    },
    "currentStatus": {
      "summary": "肺部病灶稳定；AFP上升",
      "confidence": "high",
      "reasoning": ""
    },
    "intendedTrialCenter": {
      "value": null, // "中山医院" or null
      "confidence": "high",
      "reasoning": "原文未提及"
    }
  },
  "treatmentHistory": [
    {
      "line": 1,
      "startDate": "2021-03-01", // 统一为 YYYY-MM-DD 格式
      "endDate": "2023-01-01", // 治疗结束或更换方案的时间
      "regimen": ["索拉非尼"], // 药物/治疗方案，支持联合用药
      "modality": ["靶向治疗"], // "靶向治疗", "免疫治疗", "化疗", "放疗", "手术", "消融"等
      "outcome": "SD", // 标准化为 "CR", "PR", "SD", "PD", "NE" (Not Evaluated)
      "notes": "疗效评估于XXXX年XX月进行"
    },
    {
      "line": 2,
      "startDate": "2023-01-02",
      "endDate": null, // null 表示当前仍在进行
      "regimen": ["仑伐替尼", "百泽安"],
      "modality": ["靶向治疗", "免疫治疗"],
      "outcome": "NE",
      "notes": "疗效待评估"
    }
  ]
}
Part 3: 治疗路径时间线 (Treatment Timeline)

YYYY-MM-DD: [事件/治疗/评估] - [详细信息] - [疗效]

2021-03-01: 开始一线治疗 - 索拉非尼 - 疗效评估为 SD (疾病稳定)

2023-01-02: 开始二线治疗 - 仑伐替尼联合百泽安 - 疗效待评估

2023-04-15: 影像学检查 - 肺部病灶稳定

2023-05-01: 实验室检查 - AFP 指标上升
```

}

样例文本:

{

【主诉:】 肝细胞癌综合治疗9年余
【入院情况:】患者于2016-4-13发现肝右叶占位,AFP 3438ug/L, CA19-9 33.9ng/ml,MRI提示肝右叶下段恶性肿瘤,大小8.4*7.1cm: 2016-4-26在一行“肝右叶占位切除术+胆囊切除术”,术后肿块8*7.8cm,病理诊断:(肝石叶)肝细胞癌,粗梁型,III级,MVI分级MO,慢性肝炎G3S2,慢性胆囊炎。2016-11-30复查肝脏MRI:肝右叶后叶结节影,考虑新生癌灶。先后行5次介入治疗,末次2018-7,7次MWA术,末次2020-3。随访AFP逐渐升高,2021-3-19 AFP 14.13ng/ml, CEA6.36ng/ml, 2021-3-19肺部增强CT:双肺多发结节影,最大1.2cm,较前新增,考虑转移;MRI增强:肝内未见复发转移灶。2021-04查AFP 20ng/ml.
2021-04-21予仑伐替尼8mg qd治疗,2021-04-28调整为12mg qd po治疗,服药过程中有I级手足反应、皮疹及声嘶,偶有下肢关节疼痛,自行减量至8mgqd,否认血压升高、腹泻等不适。2021-04-21开始百泽安200mg q3w(共5周期,末次2021-7-13)。2021-07-13评估病情SD。2021-8-3评估肺部病灶PD,患者至莆田900医院于2021-08-05起更改方案为“双艾”方案,具体为:艾瑞卡200mg q3w(共行8周期,末次2022-01-13,因肺部感染停药至2023-03)+阿帕替尼0.25mg qd,口服靶向药期间有鼻出血、牙龈出血Ⅰ级,血压升高I-II级。并于2021-10-12至2021-10-18针对左肺病灶行γ-刀治疗。2022-01-27查胸部CT增强:两肺多发转移结节,大部分较前2021-07-13片稍增大,左肺上叶前段一结节,较前缩小;肝内未见复发转移。2022-03-04复查胸部CT:两肺多发转移结节,大部分较前片22-01-27相仿;左肺上叶炎症,较前范围增大,右肺炎症,较前相仿。后患者因肺部炎症行抗感染治疗,停用靶免治疗,2022-09于外院行肺转移瘤消融治疗,期间定期随访示肝内病灶稳定,2023-01患者肺部感染改善,遂恢复口服仑伐替尼12mg qd,仍停用免疫治疗。2023-4-7复查胸部CT见两肺多发转移结节,较前22-06-20稍增大;左肺上叶炎症,较前相仿。2023-04-07调整为百泽安200mg q3w后线治疗(至2025-03-19),期间出现肺部感染,对症治疗后好转(具体不详)。2023-06-02随访AFP 445-692-681.1ng/ml (末次2023-08-10), 2023-07-26人工腹水后针对肝S7段行RFA。2023-8-17复查胸部CT见肺部病灶较前进展,2023-8-29复查腹部增强MRI是肝内病灶坏死,壶腹部占位可能。2023-10-18莆田市第一医院胸部CT:双肺上叶病变(较前相仿),炎症?右肺上叶胸膜下棒状致密影,结节灶较前增大,考虑肿瘤性病变,双肺散在小结节,结节灶较前增多增大,肺转移?。2023-12-5复查肝内病灶坏死;胆总管末段管腔狭窄伴上方胆管扩张,两肺多发转移结节,部分较前2023-06-02略增大。2023-12-5至2024-1-4 AFP 828-748ng/ml, DCP 804mAU/ml.
2024-02-26查AFP 988.00ng/ml, DCP 231.00ng/ml;外院复查影像评估示肝内病灶稳定,双肺转移灶稍增大。2025-01于外院行肺转移灶射波刀治疗。2025-3行HAIC治疗(方案不详)。现患者为求进一步治疗收入我科。
【入院诊断:】肝细胞癌(CNLCIIIb期,肺),肺继发恶性肿瘤,慢性乙型病毒性肝炎,肝术后,胆囊切除术后状态,单纯性肝囊肿,胸腔积液,陈旧性腰椎骨折
【诊疗经过:】患者入院完善相关检查,此次评估进展,建议调整系统治疗方案,患者表示维持当前抗肿瘤方案。排除禁忌后于2025-05-07行第17周期百泽安200mg q3w ivgtt治疗,过程顺利,今日予办理出院,出院后定期门诊随访。
【出院情况:】患者一般情况可,未诉特殊不适。
【出院诊断:】恶性肿瘤免疫治疗,肝细胞癌(CNLCIIIb期,肺),肺继发恶性肿瘤 慢性乙型病毒性肝炎,肝术后,胆囊切除术后状态,单纯性肝囊肿,胸腔积液,陈旧性腰椎骨折

}

样例输出:{

### **结构化JSON数据 (Structured JSON Data)**

JSON

`{
  "patientProfile": {
    "name": {
      "value": "XXX",
      "confidence": "low",
      "reasoning": "姓名被隐去，无法从文档中提取。"
    },
    "nameAbbreviation": {
      "value": "XXX",
      "confidence": "low",
      "reasoning": "姓名被隐去，无法生成缩写。"
    },
    "gender": {
      "value": "男",
      "confidence": "high",
      "reasoning": "文档多处明确提及 [cite: 5, 38, 88]"
    },
    "age": {
      "value": 58,
      "confidence": "high",
      "reasoning": "文档多处明确提及 [cite: 4, 88]"
    },
    "diagnosis": {
      "primary": "肝细胞癌 (CNLC IIIb期, 肺转移)",
      "secondary": [
        "肺继发恶性肿瘤",
        "慢性乙型病毒性肝炎",
        "肝术后",
        "胆囊切除术后状态",
        "单纯性肝囊肿",
        "胸腔积液",
        "陈旧性腰椎骨折",
        "高血压"
      ],
      "confidence": "high",
      "reasoning": "根据入院及出院诊断综合得出 [cite: 22, 25, 89, 120]"
    },
    "history": {
      "pastMedicalHistory": "高血压 [cite: 89, 120], 左侧冈上肌腱损伤 [cite: 34]",
      "pastOncologyHistory": "肝细胞癌综合治疗9年余, 始于2016年4月 [cite: 17, 18]",
      "confidence": "high",
      "reasoning": "病历中有详细的既往史描述"
    }
  },
  "clinicalInformation": {
    "pathology": {
      "type": "肝细胞癌, 粗梁型",
      "grade": "III级",
      "MVI": "M1",
      "notes": "慢性肝炎G3S2 [cite: 18, 47], 癌周见微血管侵犯(MVI) [cite: 42]",
      "confidence": "high",
      "reasoning": "2016-04-26术后病理报告有明确描述 [cite: 18, 42, 47]"
    },
    "geneticMutations": [
      {
        "gene": "Immunohistochemistry",
        "status": null,
        "details": "CD34(+), CK19(-), GPC3(+), Arginase(+), MVI分级=M1 [cite: 43, 47]",
        "confidence": "high",
        "reasoning": "源自2016年的术后免疫组化病理报告 [cite: 43]"
      }
    ],
    "tumorMarkers": [
      {
        "marker": "AFP",
        "value": "18756.0 ng/mL",
        "date": "2025-05-06",
        "trend": "显著升高",
        "reasoning": "从2016年的3438ug/L至2025年5月的18756ng/mL，呈持续升高趋势 [cite: 18, 372]"
      },
      {
        "marker": "PIVKA-II (DCP)",
        "value": "1864.00 ng/mL",
        "date": "2025-05-06",
        "trend": "显著升高",
        "reasoning": "从2023年12月的804mAU/ml升高至2025年5月的1864ng/mL [cite: 19, 376]"
      },
      {
        "marker": "CEA",
        "value": "21.29 ng/mL",
        "date": "2025-05-06",
        "trend": "升高",
        "reasoning": "高于参考值(<5.0 ng/mL) [cite: 379, 381, 382]"
      },
      {
        "marker": "CA19-9",
        "value": "41.6 U/mL",
        "date": "2025-05-06",
        "trend": "升高",
        "reasoning": "高于参考值(<34.0 U/mL) [cite: 386, 387]"
      }
    ],
    "ecogScore": {
      "value": null,
      "confidence": "low",
      "reasoning": "病历中未明确记录ECOG评分"
    },
    "currentStatus": {
      "summary": "患者一般情况可 [cite: 24]。影像学评估为进展：肝内多发活动灶，两肺多发转移瘤较前增大、增多 [cite: 104, 125, 82, 83]。",
      "confidence": "high",
      "reasoning": "基于2025年5月的出院情况和影像学诊断"
    },
    "intendedTrialCenter": {
      "value": null,
      "confidence": "high",
      "reasoning": "原文未提及"
    }
  },
  "treatmentHistory": [
    {
      "line": 0,
      "startDate": "2016-04-26",
      "endDate": "2020-03-01",
      "regimen": [
        "肝右叶切除术",
        "胆囊切除术",
        "介入治疗 (TACE)",
        "微波消融术 (MWA)"
      ],
      "modality": ["手术", "局部治疗"],
      "outcome": "复发",
      "notes": "2016-04-26行手术 。术后复发，先后行5次介入和7次MWA治疗，末次MWA为2020年3月 。"
    },
    {
      "line": 1,
      "startDate": "2021-04-21",
      "endDate": "2021-08-03",
      "regimen": ["仑伐替尼", "百泽安 (替雷利珠单抗)"],
      "modality": ["靶向治疗", "免疫治疗"],
      "outcome": "PD",
      "notes": "2021-07-13评估为SD 。2021-08-03因肺部病灶进展(PD)更换方案 。"
    },
    {
      "line": 2,
      "startDate": "2021-08-05",
      "endDate": "2023-04-06",
      "regimen": ["艾瑞卡 (卡瑞利珠单抗)", "阿帕替尼", "仑伐替尼"],
      "modality": ["免疫治疗", "靶向治疗", "局部治疗"],
      "outcome": "PD",
      "notes": "期间因肺部感染于2022-01-13至2023-03暂停免疫治疗 。2021-10行左肺病灶伽马刀治疗 。2022-09行肺转移瘤消融 。2023-01恢复单药仑伐替尼 。2023-04-07因肺结节增大评为PD 。"
    },
    {
      "line": 3,
      "startDate": "2023-04-07",
      "endDate": null,
      "regimen": ["百泽安 (替雷利珠单抗)"],
      "modality": ["免疫治疗", "局部治疗"],
      "outcome": "PD",
      "notes": "当前治疗方案。期间于2023-07-26行肝脏RFA ，2025-01行肺转移灶射波刀 ，2025-03行HAIC治疗 。2025-05-07完成第17周期百泽安治疗 [cite: 23]。影像学持续评估为进展 [cite: 19, 82, 104, 125]。"
    }
  ]
}`

### **治疗路径时间线 (Treatment Timeline)**

- 2016-04-13:
    
    **初次诊断** - 发现肝右叶占位，AFP 3438ug/L 。
    
- 2016-04-26:
    
    **手术治疗** - 行“肝右叶占位切除术+胆囊切除术” 。
    
- 2016-11-30 - 2020-03:
    
    **局部治疗** - 因术后复发，先后接受5次介入治疗和7次微波消融(MWA)治疗 。
    
- 2021-03-19:
    
    **首次转移** - 肺部CT发现多发结节，考虑转移 。
    
- 2021-04-21:
    
    **开始一线系统治疗** - 仑伐替尼 + 百泽安(替雷利珠单抗) - **疗效评估为 SD (疾病稳定)** 。
    
- 2021-08-05:
    
    **开始二线系统治疗** - 因肺部病灶进展(PD)，更换为“双艾”方案 (艾瑞卡+阿帕替尼) 。
    
- 2021-10-12:
    
    **局部治疗** - 针对左肺病灶行伽马刀治疗 。
    
- 2022-01-13:
    
    **治疗中断** - 因肺部感染暂停免疫治疗 。
    
- 2023-01-01:
    
    **恢复部分治疗** - 肺部感染改善，恢复口服仑伐替尼单药 。
    
- 2023-04-07:
    
    **开始三线系统治疗** - 因肺部转移灶增大(PD)，调整为百泽安(替雷利珠单抗)后线治疗 。
    
- 2023-07-26:
    
    **局部治疗** - 针对肝S7段行射频消融(RFA) 。
    
- 2025-01:
    
    **局部治疗** - 针对肺转移灶行射波刀治疗 。
    
- 2025-03:
    
    **局部治疗** - 行肝动脉灌注化疗(HAIC) 。
    
- 2025-05-07:
    
    **当前治疗** - 完成第17周期百泽安治疗，但近期影像学评估仍为**PD (疾病进展)** 。
    

}
