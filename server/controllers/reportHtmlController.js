const mongoose = require('mongoose');
const { MedicalRecord } = require('../models');
const { BadRequestError, NotFoundError } = require('../utils/httpError');

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeText(value) {
  return String(value ?? '').trim();
}

function list(value) {
  if (Array.isArray(value)) return value.map((v) => safeText(v)).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function flattenObject(obj, prefix = '', out = []) {
  if (!obj || typeof obj !== 'object') return out;
  if (Array.isArray(obj)) {
    out.push({ key: prefix, value: obj.map((v) => safeText(v)).filter(Boolean).join('，') || '—' });
    return out;
  }

  Object.entries(obj).forEach(([k, v]) => {
    const nextKey = prefix ? `${prefix}.${k}` : k;
    if (v === null || v === undefined || v === '') {
      out.push({ key: nextKey, value: '—' });
      return;
    }
    if (Array.isArray(v)) {
      out.push({ key: nextKey, value: v.map((x) => safeText(x)).filter(Boolean).join('，') || '—' });
      return;
    }
    if (typeof v === 'object') {
      // If it's a LLM field object with {value, confidence, evidence}, prefer value.
      if (v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, 'value')) {
        const vv = v.value;
        const conf = v.confidence ? `（置信度:${safeText(v.confidence)}）` : '';
        out.push({ key: nextKey, value: `${safeText(vv) || '—'}${conf}` });
        return;
      }
      flattenObject(v, nextKey, out);
      return;
    }
    out.push({ key: nextKey, value: safeText(v) || '—' });
  });

  return out;
}

function renderStructuredTable(sd) {
  const rows = flattenObject(sd || {}).slice(0, 180);
  const body = rows.map((row) => {
    return `<tr>
      <td style="padding:10px 12px;border-top:1px solid var(--border);color:var(--muted);font-size:12px;white-space:nowrap;">${esc(row.key)}</td>
      <td style="padding:10px 12px;border-top:1px solid var(--border);font-size:13px;">${esc(row.value)}</td>
    </tr>`;
  }).join('');

  return `
  <div style="overflow:auto;border:1px solid var(--border);border-radius:12px;background:#fff;">
    <table style="border-collapse:collapse;width:100%;min-width:720px;">
      <thead>
        <tr>
          <th style="text-align:left;padding:10px 12px;background:#f8fafc;color:#334155;font-size:12px;">字段</th>
          <th style="text-align:left;padding:10px 12px;background:#f8fafc;color:#334155;font-size:12px;">值</th>
        </tr>
      </thead>
      <tbody>
        ${body || '<tr><td colspan="2" style="padding:12px;color:#94a3b8">暂无结构化数据</td></tr>'}
      </tbody>
    </table>
  </div>
  <div class="note">注：此表为摘要视图（前 180 行），核心信息建议以下方“治疗史/检验”专用表为准。</div>
  `;
}

function renderTreatmentsTable(sd) {
  const tx = Array.isArray(sd?.systemic_treatments) ? sd.systemic_treatments : [];
  const rows = tx.slice(0, 30).map((t) => {
    const regimen = Array.isArray(t.regimen) ? t.regimen.join(' + ') : safeText(t.regimen);
    const ae = Array.isArray(t.adverse_events) ? t.adverse_events.join('；') : safeText(t.adverse_events);
    return `<tr>
      <td style="padding:10px 12px;border-top:1px solid var(--border);font-size:12px;color:var(--muted);white-space:nowrap;">${esc(t.line ?? '—')}</td>
      <td style="padding:10px 12px;border-top:1px solid var(--border);font-size:13px;">${esc(regimen || '—')}</td>
      <td style="padding:10px 12px;border-top:1px solid var(--border);font-size:13px;white-space:nowrap;">${esc(t.start_date || '—')}</td>
      <td style="padding:10px 12px;border-top:1px solid var(--border);font-size:13px;white-space:nowrap;">${esc(t.end_date || '—')}</td>
      <td style="padding:10px 12px;border-top:1px solid var(--border);font-size:13px;white-space:nowrap;">${esc(t.response || '—')}</td>
      <td style="padding:10px 12px;border-top:1px solid var(--border);font-size:13px;">${esc(t.reason_stopped || '—')}</td>
      <td style="padding:10px 12px;border-top:1px solid var(--border);font-size:13px;">${esc(ae || '—')}</td>
    </tr>`;
  }).join('');

  return `
  <div style="overflow:auto;border:1px solid var(--border);border-radius:12px;background:#fff;">
    <table style="border-collapse:collapse;width:100%;min-width:980px;">
      <thead>
        <tr>
          <th style="text-align:left;padding:10px 12px;background:#f8fafc;color:#334155;font-size:12px;">线次</th>
          <th style="text-align:left;padding:10px 12px;background:#f8fafc;color:#334155;font-size:12px;">方案</th>
          <th style="text-align:left;padding:10px 12px;background:#f8fafc;color:#334155;font-size:12px;">开始</th>
          <th style="text-align:left;padding:10px 12px;background:#f8fafc;color:#334155;font-size:12px;">结束</th>
          <th style="text-align:left;padding:10px 12px;background:#f8fafc;color:#334155;font-size:12px;">疗效</th>
          <th style="text-align:left;padding:10px 12px;background:#f8fafc;color:#334155;font-size:12px;">停药/变更原因</th>
          <th style="text-align:left;padding:10px 12px;background:#f8fafc;color:#334155;font-size:12px;">重要不良反应</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="7" style="padding:12px;color:#94a3b8">暂无系统治疗史（或未在病历中出现）</td></tr>'}
      </tbody>
    </table>
  </div>`;
}

function renderProcedures(sd) {
  const surgeries = Array.isArray(sd?.surgeries) ? sd.surgeries : [];
  const rt = Array.isArray(sd?.radiotherapy) ? sd.radiotherapy : [];

  const renderList = (items) => {
    if (!items.length) return '<div style="color:#94a3b8;font-size:13px">—</div>';
    return `<ul style="margin:0;padding-left:18px;">${items.slice(0, 12).map((x) => `<li style=\"margin:6px 0;\">${esc(typeof x === 'string' ? x : JSON.stringify(x))}</li>`).join('')}</ul>`;
  };

  return `
  <div class="grid two" style="margin-top:12px">
    <div class="card">
      <h2>手术史</h2>
      ${renderList(surgeries)}
    </div>
    <div class="card">
      <h2>放疗史</h2>
      ${renderList(rt)}
    </div>
  </div>`;
}

function normalizeLabValue(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v.trim() || '—';
  if (typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, 'value')) return safeText(v.value) || '—';
  return safeText(v) || '—';
}

function renderLabsTable(sd) {
  const lv = sd?.lab_values;

  // Case 1: already an array of dated lab panels
  if (Array.isArray(lv)) {
    const groups = lv.slice(0, 12).map((panel) => {
      const date = panel.date || panel.sample_date || panel.collected_at || '—';
      const items = panel.items || panel.values || panel.results || {};
      const rows = Object.entries(items || {}).slice(0, 80).map(([k, v]) => {
        return `<tr>
          <td style="padding:10px 12px;border-top:1px solid var(--border);color:var(--muted);font-size:12px;white-space:nowrap;">${esc(k)}</td>
          <td style="padding:10px 12px;border-top:1px solid var(--border);font-size:13px;">${esc(normalizeLabValue(v))}</td>
        </tr>`;
      }).join('');

      return `
        <div style="margin-top:10px">
          <div style="font-weight:700;margin:2px 0 8px">采样/报告日期：${esc(date)}</div>
          <div style="overflow:auto;border:1px solid var(--border);border-radius:12px;background:#fff;">
            <table style="border-collapse:collapse;width:100%;min-width:720px;">
              <thead>
                <tr>
                  <th style="text-align:left;padding:10px 12px;background:#f8fafc;color:#334155;font-size:12px;">项目</th>
                  <th style="text-align:left;padding:10px 12px;background:#f8fafc;color:#334155;font-size:12px;">结果</th>
                </tr>
              </thead>
              <tbody>
                ${rows || '<tr><td colspan="2" style="padding:12px;color:#94a3b8">—</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>`;
    }).join('');

    return `<div>${groups || '<div style="color:#94a3b8">暂无检验数据</div>'}</div>`;
  }

  // Case 2: object map
  if (lv && typeof lv === 'object') {
    const rows = Object.entries(lv).slice(0, 120).map(([k, v]) => {
      return `<tr>
        <td style="padding:10px 12px;border-top:1px solid var(--border);color:var(--muted);font-size:12px;white-space:nowrap;">${esc(k)}</td>
        <td style="padding:10px 12px;border-top:1px solid var(--border);font-size:13px;">${esc(normalizeLabValue(v))}</td>
      </tr>`;
    }).join('');

    return `
    <div style="overflow:auto;border:1px solid var(--border);border-radius:12px;background:#fff;">
      <table style="border-collapse:collapse;width:100%;min-width:720px;">
        <thead>
          <tr>
            <th style="text-align:left;padding:10px 12px;background:#f8fafc;color:#334155;font-size:12px;">项目</th>
            <th style="text-align:left;padding:10px 12px;background:#f8fafc;color:#334155;font-size:12px;">结果</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="2" style="padding:12px;color:#94a3b8">暂无检验数据</td></tr>'}
        </tbody>
      </table>
    </div>
    <div class="note">注：当前检验数据尚未按“多时间点”标准化；下一步会把 OCR 表格解析成按日期分组的数组结构。</div>`;
  }

  return '<div style="color:#94a3b8;font-size:13px">暂无检验数据</div>';
}

function renderPills(items = [], tone = 'blue') {
  return items
    .slice(0, 12)
    .map((item) => `<span class="pill pill--${esc(tone)}">${esc(item)}</span>`)
    .join('');
}

async function getMatchReportHtml(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      throw new BadRequestError('Invalid medical record identifier');
    }

    const record = await MedicalRecord.findOne({ _id: id, userId: req.userId });
    if (!record) {
      throw new NotFoundError('Medical record not found');
    }

    const matches = Array.isArray(record.matchResults) ? record.matchResults : [];
    const provider = record.matchMetadata || {};

    const top = matches
      .slice()
      .sort((a, b) => Number(b?.match_score ?? 0) - Number(a?.match_score ?? 0))
      .slice(0, 10);

    const sd = record.structuredData || {};

    const missingChecklist = provider.missingChecklist || {};
    const missing = Array.from(new Set([
      ...list(missingChecklist.requiredFields),
      ...list(missingChecklist.trialIntents)
    ])).slice(0, 30);

    const title = '临床试验匹配报告（HTML）';
    const generatedAt = new Date().toLocaleString();

    const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
  :root {
    --bg: #f6f7fb;
    --surface: #ffffff;
    --text: #0b1220;
    --muted: #64748b;
    --border: rgba(15, 23, 42, 0.10);
    --shadow: 0 14px 38px rgba(2, 6, 23, 0.08);

    --accent: #2563eb;
    --accent2: #7c3aed;

    --ok-bg: #ecfdf5;
    --ok-fg: #065f46;
    --ok-bd: #a7f3d0;

    --warn-bg: #fffbeb;
    --warn-fg: #92400e;
    --warn-bd: #fde68a;

    --bad-bg: #fef2f2;
    --bad-fg: #991b1b;
    --bad-bd: #fecaca;

    --info-bg: #eff6ff;
    --info-fg: #1e40af;
    --info-bd: #bfdbfe;

    --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0b1220;
      --surface: #0f172a;
      --text: #e5e7eb;
      --muted: #94a3b8;
      --border: rgba(148, 163, 184, 0.22);
      --shadow: 0 16px 46px rgba(0, 0, 0, 0.55);

      --ok-bg: rgba(16, 185, 129, 0.12);
      --ok-fg: #6ee7b7;
      --ok-bd: rgba(16, 185, 129, 0.28);

      --warn-bg: rgba(245, 158, 11, 0.12);
      --warn-fg: #fbbf24;
      --warn-bd: rgba(245, 158, 11, 0.28);

      --bad-bg: rgba(239, 68, 68, 0.12);
      --bad-fg: #fca5a5;
      --bad-bd: rgba(239, 68, 68, 0.28);

      --info-bg: rgba(59, 130, 246, 0.12);
      --info-fg: #93c5fd;
      --info-bd: rgba(59, 130, 246, 0.28);
    }
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Segoe UI", Roboto, Helvetica, Arial;
    background: var(--bg);
    color: var(--text);
    line-height: 1.45;
  }

  .container { max-width: 1040px; margin: 0 auto; padding: 28px 18px 64px; }

  .header {
    border-radius: 18px;
    padding: 18px 18px;
    background: radial-gradient(1000px 400px at 10% 0%, rgba(255,255,255,0.18), rgba(255,255,255,0)),
                linear-gradient(135deg, var(--accent), var(--accent2));
    color: #fff;
    box-shadow: var(--shadow);
  }

  .header-top { display:flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
  .header h1 { margin: 0; font-size: 22px; letter-spacing: 0.2px; }
  .header .meta { font-size: 12px; opacity: 0.92; line-height: 1.5; }

  .chips { display:flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .chip {
    display:inline-flex; align-items:center; gap: 8px;
    padding: 6px 10px;
    border-radius: 999px;
    background: rgba(255,255,255,0.16);
    border: 1px solid rgba(255,255,255,0.22);
    font-size: 12px;
    backdrop-filter: blur(10px);
  }
  .chip b { font-weight: 700; }

  .grid { display: grid; grid-template-columns: 1fr; gap: 14px; margin-top: 14px; }
  @media (min-width: 920px) { .grid.two { grid-template-columns: 1fr 1fr; } }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 18px;
    padding: 16px;
    box-shadow: 0 10px 26px rgba(2,6,23,0.06);
  }

  .card h2 { margin: 0 0 10px; font-size: 15px; letter-spacing: 0.2px; }

  .kv { display: grid; grid-template-columns: 140px 1fr; gap: 8px 12px; font-size: 13px; }
  .kv .k { color: var(--muted); }
  .kv .v { color: var(--text); word-break: break-word; }

  .pill-row { display:flex; flex-wrap: wrap; gap: 8px; }
  .pill {
    display:inline-flex; align-items:center;
    padding: 5px 10px;
    border-radius: 999px;
    border: 1px solid var(--info-bd);
    background: var(--info-bg);
    color: var(--info-fg);
    font-size: 12px;
    line-height: 1;
    white-space: nowrap;
  }
  .pill--green { border-color: var(--ok-bd); background: var(--ok-bg); color: var(--ok-fg); }
  .pill--red { border-color: var(--bad-bd); background: var(--bad-bg); color: var(--bad-fg); }
  .pill--amber { border-color: var(--warn-bd); background: var(--warn-bg); color: var(--warn-fg); }
  .pill--blue { border-color: var(--info-bd); background: var(--info-bg); color: var(--info-fg); }

  .section-title { margin: 18px 0 10px; font-size: 15px; color: var(--text); font-weight: 800; }

  .trial {
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 14px;
    background: var(--surface);
  }
  .trial-head { display:flex; justify-content: space-between; gap: 12px; }
  .trial-title { font-weight: 800; font-size: 14px; line-height: 1.35; }
  .trial-meta { font-size: 12px; color: var(--muted); margin-top: 6px; }

  .score {
    min-width: 160px;
    text-align: right;
  }
  .score .num { font-weight: 900; font-size: 22px; color: var(--text); }
  .score small { display:block; font-weight: 600; font-size: 11px; color: var(--muted); }
  .scorebar { height: 8px; border-radius: 999px; background: rgba(148,163,184,0.22); overflow: hidden; margin-top: 8px; }
  .scorebar > i { display:block; height:100%; width: var(--p, 0%); background: linear-gradient(90deg, var(--accent), var(--accent2)); border-radius: 999px; }

  .cols { display:grid; grid-template-columns: 1fr; gap: 10px; margin-top: 12px; }
  @media (min-width: 920px) { .cols { grid-template-columns: 1fr 1fr 1fr; } }
  .col h3 { font-size: 12px; margin: 0 0 6px; letter-spacing: 0.2px; }

  .note { margin-top: 10px; font-size: 12px; color: var(--muted); }

  table { width: 100%; }

  details > summary { list-style: none; }
  details > summary::-webkit-details-marker { display: none; }

  @media print {
    body { background: #fff; color: #111827; }
    .container { padding: 0; }
    .header { box-shadow: none; }
    .card, .trial { box-shadow: none; }
    .chip { background: rgba(0,0,0,0.05); border-color: rgba(0,0,0,0.12); color: #111827; }
  }
</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-top">
        <div>
          <h1>${esc(title)}</h1>
          <div class="meta">
            生成时间：${esc(generatedAt)} · 输出：Top ${top.length}<br/>
            病历ID：<span style="font-family:var(--mono)">${esc(String(record._id))}</span>
          </div>
        </div>
        <div class="meta" style="text-align:right">
          数据来源：本地试验库<br/>
          匹配引擎：${esc(provider.name || 'classic-rule-engine')}
        </div>
      </div>

      <div class="chips">
        <span class="chip"><b>诊断</b>${esc(sd.primary_diagnosis || '—')}</span>
        <span class="chip"><b>分期</b>${esc(sd.staging_value || '—')}</span>
        <span class="chip"><b>转移</b>${esc((Array.isArray(sd.metastasis_sites) ? sd.metastasis_sites.join('、') : sd.metastasis_sites) || '—')}</span>
        <span class="chip"><b>age</b>${esc(sd.age != null ? String(sd.age) : '—')}</span>
        <span class="chip"><b>ECOG</b>${esc(sd.ecog_score != null ? String(sd.ecog_score) : (sd.performance_status || '—'))}</span>
      </div>
    </div>

    <div class="grid two">
      <div class="card">
        <h2>一、病历摘要（决策视图）</h2>
        <div class="kv">
          <div class="k">主要诊断</div><div class="v">${esc(sd.primary_diagnosis || '—')}</div>
          <div class="k">病理类型</div><div class="v">${esc(sd.pathology_type || '—')}</div>
          <div class="k">分期</div><div class="v">${esc(sd.staging_value || '—')}</div>
          <div class="k">转移部位</div><div class="v">${esc((Array.isArray(sd.metastasis_sites) ? sd.metastasis_sites.join('、') : sd.metastasis_sites) || '—')}</div>
          <div class="k">年龄（age）</div><div class="v">${esc(sd.age != null ? String(sd.age) : '—')}</div>
          <div class="k">性别</div><div class="v">${esc(sd.gender || '—')}</div>
          <div class="k">ECOG</div><div class="v">${esc(sd.ecog_score != null ? String(sd.ecog_score) : (sd.performance_status || '—'))}</div>
          <div class="k">乙肝状态</div><div class="v">${esc(sd.viral_hepatitis?.hbv_status || '—')}</div>
          <div class="k">主诉/症状</div><div class="v">${esc((sd.chief_complaint || '') || (Array.isArray(sd.symptoms) ? sd.symptoms.join('；') : sd.symptoms) || '—')}</div>
          <div class="k">来源文件</div><div class="v">${esc(record.originalFileName || '—')}</div>
        </div>
        <div class="note">此摘要用于快速判断是否值得进一步联系/预筛；细节见下方治疗史与检验表。</div>
      </div>

      <div class="card">
        <h2>二、匹配概览</h2>
        <div class="kv">
          <div class="k">候选试验总数</div><div class="v">${esc(provider.totalTrials != null ? String(provider.totalTrials) : '—')}</div>
          <div class="k">评估试验数</div><div class="v">${esc(provider.evaluatedTrials != null ? String(provider.evaluatedTrials) : '—')}</div>
          <div class="k">匹配结果总数</div><div class="v">${esc(provider.matchedTrialsTotal != null ? String(provider.matchedTrialsTotal) : String(matches.length))}</div>
        </div>
        ${missing.length ? `<div class="note" style="margin-top:10px"><strong>需确认/补齐（会影响入排）：</strong></div><div class="pill-row" style="margin-top:8px">${renderPills(missing,'amber')}</div>` : ''}
      </div>
    </div>

    <details class="card" style="margin-top:14px" open>
      <summary style="cursor:pointer;font-weight:700;font-size:14px;">结构化病历字段表（机器视图 / 可折叠）</summary>
      <div style="margin-top:12px">${renderStructuredTable(sd)}</div>
    </details>

    <div class="card" style="margin-top:14px">
      <h2>历史治疗情况（系统治疗线次）</h2>
      ${renderTreatmentsTable(sd)}
      <div class="note">注：方案/线次/起止/疗效/不良反应会影响试验入排；如缺失，建议补齐。</div>
    </div>

    ${renderProcedures(sd)}

    <div class="card" style="margin-top:14px">
      <h2>检验结果（按时间点）</h2>
      ${renderLabsTable(sd)}
    </div>

    <div class="section-title">三、推荐临床试验（Top 10）</div>

    <div class="grid">
      ${top.map((m, idx) => {
        const tm = m.trial_metadata || {};
        const inc = list(m?.summary?.inclusion_met).slice(0, 6);
        const exc = list(m?.summary?.exclusion_triggered).slice(0, 6);
        const un = list(m?.summary?.uncertain).slice(0, 6);
        const meta = [
          tm.phase ? `分期: ${tm.phase}` : '',
          (tm.location || tm.city || tm.province) ? `地点: ${tm.location || tm.city || tm.province}` : '',
          tm.status ? `状态: ${tm.status}` : ''
        ].filter(Boolean).join('  |  ');

        return `
        <div class="trial">
          <div class="trial-head">
            <div>
              <div class="trial-title">${idx + 1}. ${esc(m.trial_title || m.trial_id || '未命名试验')}</div>
              <div class="trial-meta">${esc(m.trial_id || '')} ${meta ? ` · ${esc(meta)}` : ''}</div>
              ${m.rank_reason ? `<div class="note"><strong>推荐理由：</strong>${esc(m.rank_reason)}</div>` : ''}
            </div>
            <div class="score">
              <div class="num">${esc(String(m.match_score ?? 0))}</div>
              <small>匹配度</small>
              <div class="scorebar" style="--p:${Math.max(0, Math.min(100, Number(m.match_score ?? 0)))}%"><i></i></div>
            </div>
          </div>
          <div class="cols">
            <div class="col">
              <h3 style="color:#065f46">满足</h3>
              <div class="pill-row">${renderPills(inc,'green') || '<span style="color:#94a3b8;font-size:12px">—</span>'}</div>
            </div>
            <div class="col">
              <h3 style="color:#991b1b">不满足/风险</h3>
              <div class="pill-row">${renderPills(exc,'red') || '<span style="color:#94a3b8;font-size:12px">—</span>'}</div>
            </div>
            <div class="col">
              <h3 style="color:#92400e">待确认</h3>
              <div class="pill-row">${renderPills(un,'amber') || '<span style="color:#94a3b8;font-size:12px">—</span>'}</div>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getMatchReportHtml
};
