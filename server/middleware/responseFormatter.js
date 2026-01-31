const responseFormatter = (req, res, next) => {
  res.success = (data, { message = 'OK', status = 200, meta } = {}) => {
    if (res.headersSent) return res;
    return res.status(status).json({
      success: true,
      message,
      data,
      meta,
      traceId: req.id
    });
  };

  res.fail = (message, { status = 400, code, meta, details } = {}) => {
    if (res.headersSent) return res;
    return res.status(status).json({
      success: false,
      message,
      code,
      meta,
      details,
      traceId: req.id
    });
  };

  next();
};

module.exports = responseFormatter;
