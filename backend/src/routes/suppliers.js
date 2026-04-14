'use strict';
const express = require('express');
const db = require('../db');
const audit = require('../services/audit');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');

const router = express.Router();
router.use(authenticate);

// ─── GET /api/suppliers ───────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { orgId } = req.officer;
  const { blacklisted, search, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    const result = await db.withOrg(orgId, async (client) => {
      const conditions = ['org_id = $1'];
      const params = [orgId];
      let idx = 2;

      if (blacklisted !== undefined) {
        conditions.push(`is_blacklisted = $${idx++}`);
        params.push(blacklisted === 'true');
      }
      if (search) {
        conditions.push(`(name ILIKE $${idx} OR registration_number ILIKE $${idx})`);
        params.push(`%${search}%`);
        idx++;
      }

      params.push(parseInt(limit), offset);
      const where = conditions.join(' AND ');

      const [rows, count] = await Promise.all([
        client.query(
          `SELECT * FROM suppliers WHERE ${where}
           ORDER BY is_blacklisted ASC, name ASC
           LIMIT $${idx} OFFSET $${idx + 1}`,
          params
        ),
        client.query(
          `SELECT COUNT(*) FROM suppliers WHERE ${where}`,
          params.slice(0, -2)
        ),
      ]);

      return { rows: rows.rows, total: parseInt(count.rows[0].count) };
    });

    return res.json({
      data: result.rows,
      pagination: {
        total: result.total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(result.total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error('[suppliers/list]', err);
    return res.status(500).json({ error: 'Failed to fetch suppliers' });
  }
});

// ─── GET /api/suppliers/:id ───────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const { orgId } = req.officer;

  try {
    const result = await db.withOrg(orgId, async (client) => {
      return client.query(
        `SELECT s.*, o.full_name AS created_by_name, b.full_name AS blacklisted_by_name
         FROM suppliers s
         LEFT JOIN officers o ON o.id = s.created_by
         LEFT JOIN officers b ON b.id = s.blacklisted_by
         WHERE s.id = $1 AND s.org_id = $2`,
        [req.params.id, orgId]
      );
    });

    if (!result.rows.length) return res.status(404).json({ error: 'Supplier not found' });
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('[suppliers/get]', err);
    return res.status(500).json({ error: 'Failed to fetch supplier' });
  }
});

// ─── POST /api/suppliers ──────────────────────────────────────────────────────
// Manager or Executive can add suppliers.
router.post(
  '/',
  requireRole('Manager', 'Executive'),
  validate(schemas.createSupplier),
  async (req, res) => {
    const { orgId, id: actorId } = req.officer;
    const { name, registration_number, contact_email, contact_phone, document_expiry } = req.body;

    try {
      const result = await db.withOrg(orgId, async (client) => {
        const inserted = await client.query(
          `INSERT INTO suppliers
             (org_id, name, registration_number, contact_email, contact_phone,
              document_expiry, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [orgId, name, registration_number || null, contact_email || null,
           contact_phone || null, document_expiry || null, actorId]
        );

        await audit.log(client, {
          orgId, actorId,
          tableName: 'suppliers',
          recordId: inserted.rows[0].id,
          action: 'INSERT',
          payload: { name, registration_number, contact_email },
        });

        return inserted.rows[0];
      });

      return res.status(201).json(result);
    } catch (err) {
      console.error('[suppliers/create]', err);
      return res.status(500).json({ error: 'Failed to create supplier' });
    }
  }
);

// ─── PATCH /api/suppliers/:id/blacklist ───────────────────────────────────────
// Flag a supplier as blacklisted.
router.patch(
  '/:id/blacklist',
  requireRole('Manager', 'Executive'),
  validate(schemas.blacklistSupplier),
  async (req, res) => {
    const { orgId, id: actorId } = req.officer;
    const { reason } = req.body;

    try {
      const result = await db.withOrg(orgId, async (client) => {
        const existing = await client.query(
          'SELECT * FROM suppliers WHERE id = $1 AND org_id = $2',
          [req.params.id, orgId]
        );
        if (!existing.rows.length) {
          throw Object.assign(new Error('Supplier not found'), { status: 404 });
        }
        if (existing.rows[0].is_blacklisted) {
          throw Object.assign(new Error('Supplier is already blacklisted'), { status: 409 });
        }

        const updated = await client.query(
          `UPDATE suppliers
           SET is_blacklisted = TRUE, blacklist_reason = $1,
               blacklisted_by = $2, blacklisted_at = NOW(), updated_at = NOW()
           WHERE id = $3 RETURNING *`,
          [reason, actorId, req.params.id]
        );

        await audit.log(client, {
          orgId, actorId,
          tableName: 'suppliers',
          recordId: req.params.id,
          action: 'UPDATE',
          payload: { event: 'blacklisted', reason },
        });

        return updated.rows[0];
      });

      return res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      console.error('[suppliers/blacklist]', err);
      return res.status(500).json({ error: 'Failed to blacklist supplier' });
    }
  }
);

// ─── DELETE /api/suppliers/:id/blacklist ──────────────────────────────────────
// Lift a blacklist (Executive only).
router.delete(
  '/:id/blacklist',
  requireRole('Executive'),
  async (req, res) => {
    const { orgId, id: actorId } = req.officer;

    try {
      const result = await db.withOrg(orgId, async (client) => {
        const existing = await client.query(
          'SELECT * FROM suppliers WHERE id = $1 AND org_id = $2',
          [req.params.id, orgId]
        );
        if (!existing.rows.length) throw Object.assign(new Error('Not found'), { status: 404 });

        const updated = await client.query(
          `UPDATE suppliers
           SET is_blacklisted = FALSE, blacklist_reason = NULL,
               blacklisted_by = NULL, blacklisted_at = NULL, updated_at = NOW()
           WHERE id = $1 RETURNING *`,
          [req.params.id]
        );

        await audit.log(client, {
          orgId, actorId,
          tableName: 'suppliers',
          recordId: req.params.id,
          action: 'UPDATE',
          payload: { event: 'blacklist_lifted' },
        });

        return updated.rows[0];
      });

      return res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      console.error('[suppliers/unblacklist]', err);
      return res.status(500).json({ error: 'Failed to lift blacklist' });
    }
  }
);

// ─── PATCH /api/suppliers/:id/compliance-score ───────────────────────────────
router.patch(
  '/:id/compliance-score',
  requireRole('Manager', 'Executive', 'Auditor'),
  validate(schemas.updateComplianceScore),
  async (req, res) => {
    const { orgId, id: actorId } = req.officer;
    const { compliance_score } = req.body;

    try {
      const result = await db.withOrg(orgId, async (client) => {
        const existing = await client.query(
          'SELECT * FROM suppliers WHERE id = $1 AND org_id = $2',
          [req.params.id, orgId]
        );
        if (!existing.rows.length) throw Object.assign(new Error('Not found'), { status: 404 });

        const prev = existing.rows[0].compliance_score;
        const updated = await client.query(
          `UPDATE suppliers SET compliance_score = $1, updated_at = NOW()
           WHERE id = $2 RETURNING *`,
          [compliance_score, req.params.id]
        );

        await audit.log(client, {
          orgId, actorId,
          tableName: 'suppliers',
          recordId: req.params.id,
          action: 'UPDATE',
          payload: { compliance_score, previous_score: prev },
        });

        return updated.rows[0];
      });

      return res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      console.error('[suppliers/compliance]', err);
      return res.status(500).json({ error: 'Failed to update compliance score' });
    }
  }
);

module.exports = router;
