const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const { MedicalRecord } = require('../models');
const { BadRequestError, NotFoundError } = require('../utils/httpError');

function safeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function list(value) {
  if (Array.isArray(value)) {
    return value.map((v) => safeText(v)).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function resolveCjkFontPath() {
  const envPath = safeText(process.env.PDF_FONT_PATH);
  // Prefer single-face TTF/OTF when available; TTC collections sometimes need extra font tooling.
  const candidates = [
    envPath,
    '/Library/Fonts/Arial Unicode.ttf',
    '/System/Library/Fonts/PingFang.ttc',
    '/System/Library/Fonts/Hiragino Sans GB.ttc',
    '/System/Library/Fonts/STHeiti Light.ttc',
    '/System/Library/Fonts/STHeiti Medium.ttc'
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore
    }
  }
  return null;
}

function formatLine(doc, label, value) {
  const v = safeText(value);
  if (!v) return;
  // Avoid Helvetica-Bold here because it can't render CJK.
  doc.text(`${label}: ${v}`);
}

async function getMatchReportPdf(req, res, next) {
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

    // Top 10 only (as requested)
    const top = matches
      .slice()
      .sort((a, b) => Number(b?.match_score ?? 0) - Number(a?.match_score ?? 0))
      .slice(0, 10);

    const doc = new PDFDocument({ size: 'A4', margin: 48 });

    // Ensure Chinese is renderable by embedding a CJK-capable font.
    const cjkFontPath = resolveCjkFontPath();
    if (cjkFontPath) {
      doc.registerFont('CJK', cjkFontPath);
      doc.font('CJK');
    }

    const filename = `match-report-${id}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=\"${filename}\"`);

    doc.pipe(res);

    // Title
    doc.fontSize(18).text('临床试验匹配报告（MVP）');
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#444')
      .text(`生成时间: ${new Date().toLocaleString()}`);
    doc.fillColor('black');
    doc.moveDown(1);

    // Patient summary
    doc.fillColor('black').fontSize(13).text('一、病历摘要');
    doc.moveDown(0.5);
    formatLine(doc, '病历ID', String(record._id));
    formatLine(doc, '文件名', record.originalFileName);
    formatLine(doc, '上传时间', record.uploadDate ? new Date(record.uploadDate).toLocaleString() : '');

    // Basic structured fields (best effort)
    const sd = record.structuredData || {};
    formatLine(doc, '主要诊断', sd.primary_diagnosis || sd.diagnosis);
    formatLine(doc, '分期', sd.staging_value || sd.staging || sd.stage);
    formatLine(doc, '年龄', sd.age != null ? String(sd.age) : '');
    formatLine(doc, '性别', sd.gender);
    formatLine(doc, 'ECOG', sd.ecog_score != null ? String(sd.ecog_score) : (sd.performance_status || ''));

    doc.moveDown(1);

    // Matching summary
    doc.fontSize(13).text('二、匹配概览');
    doc.moveDown(0.5);
    formatLine(doc, '候选试验总数', provider.totalTrials != null ? String(provider.totalTrials) : '');
    formatLine(doc, '评估试验数', provider.evaluatedTrials != null ? String(provider.evaluatedTrials) : '');
    formatLine(doc, '匹配结果总数', provider.matchedTrialsTotal != null ? String(provider.matchedTrialsTotal) : (matches.length ? String(matches.length) : ''));
    formatLine(doc, '本报告输出', `${top.length} 条（按匹配度降序）`);

    const missingChecklist = provider.missingChecklist || {};
    const missingFields = list(missingChecklist.requiredFields);
    const missingIntents = list(missingChecklist.trialIntents);
    if (missingFields.length || missingIntents.length) {
      doc.moveDown(0.5);
      doc.text('需确认/补齐（系统暂按满足展示）:');
      doc.fontSize(10);
      const merged = Array.from(new Set([...missingFields, ...missingIntents])).slice(0, 24);
      if (merged.length) {
        doc.text(merged.map((x) => `- ${x}`).join('\n'));
      }
      doc.fontSize(12);
    }

    doc.addPage();

    // Trials
    doc.fontSize(13).text('三、推荐试验（Top 10）');
    doc.moveDown(0.5);

    top.forEach((m, idx) => {
      const score = Number(m?.match_score ?? 0);
      const title = safeText(m?.trial_title || m?.trial_id || '未命名试验');
      const trialId = safeText(m?.trial_id);
      const tm = m?.trial_metadata || {};
      const loc = safeText(tm.location || tm.city || tm.province);
      const phase = safeText(tm.phase);
      const status = safeText(tm.status);
      const reason = safeText(m?.rank_reason);

      doc.fontSize(11).text(`${idx + 1}. ${title}`);
      doc.fontSize(10);
      if (trialId) doc.text(`编号: ${trialId}`);
      doc.text(`匹配度: ${score}`);
      const metaBits = [phase ? `分期: ${phase}` : '', loc ? `地点: ${loc}` : '', status ? `状态: ${status}` : ''].filter(Boolean);
      if (metaBits.length) doc.text(metaBits.join('  |  '));

      const summary = m?.summary || {};
      const inc = list(summary.inclusion_met).slice(0, 5);
      const exc = list(summary.exclusion_triggered).slice(0, 5);
      const un = list(summary.uncertain).slice(0, 5);

      if (reason) {
        doc.fillColor('#1e40af').text(`推荐理由: ${reason}`);
        doc.fillColor('black');
      }
      if (inc.length) doc.text(`满足: ${inc.join('；')}`);
      if (exc.length) doc.text(`风险/不满足: ${exc.join('；')}`);
      if (un.length) doc.text(`待确认: ${un.join('；')}`);

      doc.moveDown(0.6);

      // Page break guard
      if (doc.y > 740) {
        doc.addPage();
      }
    });

    doc.end();
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getMatchReportPdf
};
