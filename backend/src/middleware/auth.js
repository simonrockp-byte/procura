'use strict';
const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Verify JWT and attach officer to req.
 * Expects: Authorization: Bearer <token>
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token = header.slice(7);
  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.officer = {
    id: payload.sub,
    orgId: payload.org_id,
    role: payload.role,
    email: payload.email,
  };

  next();
}

/**
 * Role guard middleware factory.
 * Usage: requireRole('Manager', 'Executive')
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.officer) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!roles.includes(req.officer.role)) {
      return res.status(403).json({
        error: `Access denied. Required roles: ${roles.join(', ')}`,
      });
    }
    next();
  };
}

module.exports = { authenticate, requireRole };
