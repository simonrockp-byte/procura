'use strict';
const express = require('express');
const db = require('../db');
const audit = require('../services/audit');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');

const router = express.Router();
router.use(authenticate);

// ─── GET /api/officers ────────────────────────────────────────────────────────
// List all officers in the organisation.
router.get('/', requireRole('Manager', 'Executive', 'Auditor'), async (req, res) => {
  const { orgId } = req.officer;

  try {
    const result = await db.withOrg(orgId, async (client) => {
      return client.query(
        `SELECT id, email, phone_number, full_name, role, is_active, created_at, updated_at
         FROM officers
         WHERE org_id = $1
         ORDER BY full_name ASC`,
        [orgId]
      );
    });

    return res.json(result.rows);
  } catch (err) {
    console.error('[officers/list]', err);
    return res.status(500).json({ error: 'Failed to fetch officers' });
  }
});

// ─── PATCH /api/officers/:id ──────────────────────────────────────────────────
// Update role or deactivation status. (Executive only)
router.patch('/:id', requireRole('Executive'), validate(schemas.updateOfficer), async (req, res) => {
  const { orgId, id: actorId } = req.officer;
  const { role, is_active } = req.body;

  if (role === undefined && is_active === undefined) {
    return res.status(400).json({ error: 'No update fields provided' });
  }

  try {
    const result = await db.withOrg(orgId, async (client) => {
      const current = await client.query(
        'SELECT * FROM officers WHERE id = $1 AND org_id = $2',
        [req.params.id, orgId]
      );
      if (!current.rows.length) {
        throw Object.assign(new Error('Officer not found'), { status: 404 });
      }

      const updates = [];
      const values = [];
      let idx = 1;

      if (role !== undefined) {
        updates.push(`role = $${idx++}`);
        values.push(role);
      }
      if (is_active !== undefined) {
        updates.push(`is_active = $${idx++}`);
        values.push(is_active);
      }

      values.push(req.params.id);
      values.push(orgId);

      const query = `
        UPDATE officers
        SET ${updates.join(', ')}, updated_at = NOW()
        WHERE id = $${idx++} AND org_id = $${idx++}
        RETURNING id, email, full_name, role, is_active
      `;

      const updated = await client.query(query, values);

      await audit.log(client, {
        orgId,
        actorId,
        tableName: 'officers',
        recordId: req.params.id,
        action: 'UPDATE',
        payload: {
          role: role || current.rows[0].role,
          is_active: is_active !== undefined ? is_active : current.rows[0].is_active
        }
      });

      return updated.rows[0];
    });

    return res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[officers/update]', err);
    return res.status(500).json({ error: 'Failed to update officer' });
  }
});

module.exports = router;
