const jwt = require('jsonwebtoken');
const config = require('../config');

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const headerToken = authHeader && authHeader.split(' ')[1];
  const queryToken = typeof req.query?.token === 'string' ? req.query.token : null;
  const token = headerToken || queryToken;

  if (!token) {
    if (typeof res.fail === 'function') {
      return res.fail('Access token required', { status: 401, code: 'auth_required' });
    }
    return res.status(401).json({ success: false, message: 'Access token required', code: 'auth_required' });
  }

  jwt.verify(token, config.jwtSecret, (err, decoded) => {
    if (err) {
      if (typeof res.fail === 'function') {
        return res.fail('Invalid or expired token', { status: 403, code: 'invalid_token' });
      }
      return res.status(403).json({ success: false, message: 'Invalid or expired token', code: 'invalid_token' });
    }

    const role = decoded && typeof decoded.role === 'string' ? decoded.role : 'user';
    req.userId = decoded.userId;
    req.userRole = role;
    // expose the same shape newer controllers expect while keeping backwards compatibility
    req.user = { userId: decoded.userId, role };
    next();
  });
};

module.exports = { authenticateToken };
