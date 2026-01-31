const fs = require('fs/promises');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

let cachedPath = null;
let cachedMtime = null;
let cachedContent = null;

async function resolveCsvPath() {
  if (!config.trialCsvPath) {
    throw new Error('未配置 TRIAL_CSV_PATH，无法加载临床试验数据');
  }
  return path.isAbsolute(config.trialCsvPath)
    ? config.trialCsvPath
    : path.join(process.cwd(), config.trialCsvPath);
}

async function getTrialsCsv() {
  const csvPath = await resolveCsvPath();
  try {
    const stats = await fs.stat(csvPath);

    if (cachedContent && cachedPath === csvPath && cachedMtime === stats.mtimeMs) {
      return cachedContent;
    }

    const content = await fs.readFile(csvPath, 'utf8');
    cachedPath = csvPath;
    cachedMtime = stats.mtimeMs;
    cachedContent = content;
    return content;
  } catch (error) {
    logger.error({ err: error }, '读取临床试验数据失败');
    throw new Error('无法读取临床试验数据文件');
  }
}

module.exports = {
  getTrialsCsv
};
