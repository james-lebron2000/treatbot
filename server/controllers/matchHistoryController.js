const mongoose = require('mongoose');

const { MedicalRecord } = require('../models');
const { BadRequestError, NotFoundError } = require('../utils/httpError');
const { saveMatchSnapshot } = require('../services/matchEngineService');

async function getMatchHistory(req, res, next) {
  try {
    const { recordId } = req.params;
    const { limit: limitRaw, cursor } = req.query || {};
    if (!mongoose.isValidObjectId(recordId)) {
      throw new BadRequestError('Invalid medical record identifier');
    }

    const record = await MedicalRecord.findOne({ _id: recordId, userId: req.userId });
    if (!record) {
      throw new NotFoundError('Medical record not found');
    }

    const rawHistory = (record.matchHistory || []).map((entry) => ({
      _id: entry._id?.toString?.() || String(entry._id),
      createdAt: entry.createdAt,
      metadata: entry.metadata,
      matches: JSON.parse(JSON.stringify(entry.matches || []))
    }));

    const sortKey = (entry) => {
      const matchedAt = entry?.metadata?.matchedAt;
      const candidate = matchedAt || entry?.createdAt;
      const time = candidate ? new Date(candidate).getTime() : 0;
      return Number.isFinite(time) ? time : 0;
    };

    const sorted = rawHistory.sort((a, b) => sortKey(b) - sortKey(a));

    const limit = (() => {
      const parsed = Number(limitRaw);
      if (!Number.isFinite(parsed)) return Number(process.env.MATCH_HISTORY_PAGE_SIZE || 10);
      return Math.max(1, Math.min(100, Math.floor(parsed)));
    })();

    const startIndex = cursor
      ? Math.max(0, sorted.findIndex((entry) => entry._id === String(cursor)) + 1)
      : 0;
    const page = sorted.slice(startIndex, startIndex + limit);
    const nextCursor = (startIndex + limit) < sorted.length ? page[page.length - 1]?._id || null : null;

    return res.success({
      history: page,
      nextCursor,
      total: sorted.length,
      latest: JSON.parse(JSON.stringify(record.matchResults || [])),
      metadata: record.matchMetadata || null
    }, { message: 'Match history retrieved' });
  } catch (error) {
    return next(error);
  }
}

async function restoreMatchHistory(req, res, next) {
  try {
    const { recordId } = req.params;
    const { historyId } = req.body || {};

    if (!mongoose.isValidObjectId(recordId)) {
      throw new BadRequestError('Invalid medical record identifier');
    }
    if (!historyId || !mongoose.isValidObjectId(historyId)) {
      throw new BadRequestError('Invalid history entry identifier');
    }

    const record = await MedicalRecord.findOne({ _id: recordId, userId: req.userId });
    if (!record) {
      throw new NotFoundError('Medical record not found');
    }

    const entry = record.matchHistory?.id(historyId);
    if (!entry) {
      throw new NotFoundError('Match history entry not found');
    }

    const metadata = {
      ...(entry.metadata ? JSON.parse(JSON.stringify(entry.metadata)) : {}),
      restoredFrom: historyId,
      matchedAt: new Date().toISOString(),
      source: entry.metadata?.source || 'history-restore'
    };

    await saveMatchSnapshot(record, entry.matches || [], metadata, req.userId);

    return res.success({
      matches: record.matchResults || [],
      metadata: record.matchMetadata || metadata
    }, { message: 'Match history restored' });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getMatchHistory,
  restoreMatchHistory
};
