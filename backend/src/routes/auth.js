'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const db = require('../db');
const config = require('../config');
const audit = require('../services/audit');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');

const router = express.Router();

// ─── POST /api/auth/register ──────────────────────────────────────────────────
// Creates a new organisation + first Executive officer (the admin).
router.post('/register', validate(schemas.registerOrg), async (req, res) => {
  const { org_name, org_slug, full_name, email, password, phone_number } = req.body;

  try {
    // Check slug uniqueness (no RLS needed — reading across orgs)
    const slugCheck = await db.query(
      'SELECT id FROM organisations WHERE slug = $1',
      [org_slug]
    );
    if (slugCheck.rows.length) {
      return res.status(409).json({ error: 'Organisation slug already taken' });
    }

    const emailCheck = await db.query(
      'SELECT id FROM officers WHERE email = $1',
      [email]
    );
    if (emailCheck.rows.length) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Use a raw pool client — no org context yet (org doesn't exist)
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Create organisation
      const orgResult = await client.query(
        `INSERT INTO organisations (name, slug, default_currency, sla_hours)
         VALUES ($1, $2, 'ZMW', $3) RETURNING *`,
        [org_name, org_slug, config.escalation.defaultSlaHours]
      );
      const org = orgResult.rows[0];

      // 2. Create founding Executive officer
      const officerResult = await client.query(
        `INSERT INTO officers (org_id, email, phone_number, full_name, password_hash, role)
         VALUES ($1, $2, $3, $4, $5, 'Executive') RETURNING *`,
        [org.id, email, phone_number || null, full_name, passwordHash]
      );
      const officer = officerResult.rows[0];

      // 3. Seed org_ref_counters row for REQ prefix
      await client.query(
        `INSERT INTO org_ref_counters (org_id, prefix, last_value) VALUES ($1, 'REQ', 0)`,
        [org.id]
      );

      // 4. Audit log (set org context locally for the trigger)
      await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [org.id]);
      await audit.log(client, {
        orgId: org.id,
        actorId: officer.id,
        tableName: 'organisations',
        recordId: org.id,
        action: 'INSERT',
        payload: { name: org.name, slug: org.slug },
      });

      await client.query('COMMIT');

      const token = issueToken(officer, org);
      return res.status(201).json({
        token,
        officer: safeOfficer(officer),
        organisation: safeOrg(org),
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[auth/register]', err);
    return res.status(500).json({ error: 'Registration failed' });
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', validate(schemas.login), async (req, res) => {
  const { email, password, org_slug } = req.body;

  try {
    const result = await db.query(
      `SELECT o.*, org.id AS org_id_check, org.slug
       FROM officers o
       JOIN organisations org ON org.id = o.org_id
       WHERE o.email = $1 AND org.slug = $2`,
      [email, org_slug]
    );

    if (!result.rows.length) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const officer = result.rows[0];

    if (!officer.is_active) {
      return res.status(403).json({ error: 'Account is deactivated' });
    }

    if (!officer.password_hash) {
      return res.status(401).json({ error: 'Account setup incomplete — use invite link' });
    }

    const valid = await bcrypt.compare(password, officer.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last_login_at
    await db.query(
      'UPDATE officers SET last_login_at = NOW() WHERE id = $1',
      [officer.id]
    );

    const orgResult = await db.query(
      'SELECT * FROM organisations WHERE id = $1',
      [officer.org_id]
    );

    const token = issueToken(officer, orgResult.rows[0]);
    return res.json({ token, officer: safeOfficer(officer) });
  } catch (err) {
    console.error('[auth/login]', err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

// ─── POST /api/auth/invite ────────────────────────────────────────────────────
// Manager or Executive invites a new officer.
router.post(
  '/invite',
  authenticate,
  requireRole('Manager', 'Executive'),
  validate(schemas.inviteOfficer),
  async (req, res) => {
    const { email, full_name, role, phone_number } = req.body;
    const { orgId, id: actorId } = req.officer;

    // Executives can invite any role; Managers can only invite Officers
    if (req.officer.role === 'Manager' && role !== 'Officer') {
      return res.status(403).json({ error: 'Managers can only invite Officers' });
    }

    try {
      const inviteToken = crypto.randomBytes(32).toString('hex');
      const inviteExpires = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48h

      const result = await db.withOrg(orgId, async (client) => {
        // Check duplicate email within org
        const dup = await client.query(
          'SELECT id FROM officers WHERE org_id = $1 AND email = $2',
          [orgId, email]
        );
        if (dup.rows.length) {
          throw Object.assign(new Error('Email already exists in this organisation'), { status: 409 });
        }

        const inserted = await client.query(
          `INSERT INTO officers
             (org_id, email, phone_number, full_name, role, invited_by, invite_token, invite_expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [orgId, email, phone_number || null, full_name, role, actorId, inviteToken, inviteExpires]
        );

        await audit.log(client, {
          orgId,
          actorId,
          tableName: 'officers',
          recordId: inserted.rows[0].id,
          action: 'INSERT',
          payload: { email, role, invited_by: actorId },
        });

        return inserted.rows[0];
      });

      return res.status(201).json({
        officer: safeOfficer(result),
        invite_token: inviteToken,
        invite_expires_at: inviteExpires,
        // In production: send this token via email to the invitee
      });
    } catch (err) {
      if (err.status === 409) return res.status(409).json({ error: err.message });
      console.error('[auth/invite]', err);
      return res.status(500).json({ error: 'Invite failed' });
    }
  }
);

// ─── POST /api/auth/accept-invite ────────────────────────────────────────────
router.post('/accept-invite', validate(schemas.acceptInvite), async (req, res) => {
  const { token, password } = req.body;

  try {
    const result = await db.query(
      `SELECT o.*, org.id AS org_id_fk FROM officers o
       JOIN organisations org ON org.id = o.org_id
       WHERE o.invite_token = $1`,
      [token]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Invalid or expired invite token' });
    }

    const officer = result.rows[0];

    if (officer.invite_expires_at && new Date(officer.invite_expires_at) < new Date()) {
      return res.status(410).json({ error: 'Invite token has expired' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await db.withOrg(officer.org_id, async (client) => {
      await client.query(
        `UPDATE officers
         SET password_hash = $1, invite_token = NULL, invite_expires_at = NULL,
             is_active = TRUE, updated_at = NOW()
         WHERE id = $2`,
        [passwordHash, officer.id]
      );

      await audit.log(client, {
        orgId: officer.org_id,
        actorId: officer.id,
        tableName: 'officers',
        recordId: officer.id,
        action: 'UPDATE',
        payload: { event: 'invite_accepted' },
      });
    });

    const orgResult = await db.query('SELECT * FROM organisations WHERE id = $1', [officer.org_id]);
    const jwtToken = issueToken(officer, orgResult.rows[0]);

    return res.json({ token: jwtToken, officer: safeOfficer(officer) });
  } catch (err) {
    console.error('[auth/accept-invite]', err);
    return res.status(500).json({ error: 'Failed to accept invite' });
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
  try {
    const result = await db.withOrg(req.officer.orgId, async (client) => {
      return client.query(
        `SELECT o.*, org.name AS org_name, org.slug AS org_slug, org.default_currency
         FROM officers o
         JOIN organisations org ON org.id = o.org_id
         WHERE o.id = $1`,
        [req.officer.id]
      );
    });

    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });

    const row = result.rows[0];
    return res.json({
      officer: safeOfficer(row),
      organisation: {
        id: row.org_id,
        name: row.org_name,
        slug: row.org_slug,
        default_currency: row.default_currency,
      },
    });
  } catch (err) {
    console.error('[auth/me]', err);
    return res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function issueToken(officer, org) {
  return jwt.sign(
    {
      sub: officer.id,
      org_id: officer.org_id,
      role: officer.role,
      email: officer.email,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

function safeOfficer(o) {
  return {
    id: o.id,
    org_id: o.org_id,
    email: o.email,
    full_name: o.full_name,
    role: o.role,
    phone_number: o.phone_number,
    is_active: o.is_active,
    last_login_at: o.last_login_at,
    created_at: o.created_at,
  };
}

function safeOrg(o) {
  return {
    id: o.id,
    name: o.name,
    slug: o.slug,
    default_currency: o.default_currency,
    sla_hours: o.sla_hours,
  };
}

module.exports = router;
