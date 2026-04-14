'use strict';
const express = require('express');
const db = require('../db');
const audit = require('../services/audit');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');

const router = express.Router();
router.use(authenticate);

// ─── GET /api/requisitions ────────────────────────────────────────────────────
// Officers see only their own; Managers/Executives/Auditors see all in org.
router.get('/', async (req, res) => {
  const { orgId, id: officerId, role } = req.officer;
  const { status, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    const result = await db.withOrg(orgId, async (client) => {
      let where = ['r.org_id = $1'];
      const params = [orgId];
      let idx = 2;

      if (role === 'Officer') {
        where.push(`r.created_by = $${idx++}`);
        params.push(officerId);
      }
      if (status) {
        where.push(`r.status = $${idx++}`);
        params.push(status);
      }

      params.push(parseInt(limit), offset);
      const whereClause = where.join(' AND ');

      const [rows, count] = await Promise.all([
        client.query(
          `SELECT r.*,
                  o.full_name AS created_by_name,
                  s.name      AS supplier_name
           FROM requisitions r
           LEFT JOIN officers  o ON o.id = r.created_by
           LEFT JOIN suppliers s ON s.id = r.supplier_id
           WHERE ${whereClause}
           ORDER BY r.created_at DESC
           LIMIT $${idx++} OFFSET $${idx}`,
          params
        ),
        client.query(
          `SELECT COUNT(*) FROM requisitions r WHERE ${whereClause}`,
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
    console.error('[requisitions/list]', err);
    return res.status(500).json({ error: 'Failed to fetch requisitions' });
  }
});

// ─── GET /api/requisitions/:id ────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const { orgId, id: officerId, role } = req.officer;

  try {
    const result = await db.withOrg(orgId, async (client) => {
      return client.query(
        `SELECT r.*,
                o.full_name  AS created_by_name,
                a.full_name  AS approved_by_name,
                s.name       AS supplier_name,
                s.is_blacklisted AS supplier_blacklisted,
                s.compliance_score AS supplier_compliance_score
         FROM requisitions r
         LEFT JOIN officers  o ON o.id = r.created_by
         LEFT JOIN officers  a ON a.id = r.approved_by
         LEFT JOIN suppliers s ON s.id = r.supplier_id
         WHERE r.id = $1 AND r.org_id = $2`,
        [req.params.id, orgId]
      );
    });

    if (!result.rows.length) return res.status(404).json({ error: 'Requisition not found' });

    const req_ = result.rows[0];
    // Officers can only view their own
    if (role === 'Officer' && req_.created_by !== officerId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    return res.json(req_);
  } catch (err) {
    console.error('[requisitions/get]', err);
    return res.status(500).json({ error: 'Failed to fetch requisition' });
  }
});

// ─── POST /api/requisitions ───────────────────────────────────────────────────
router.post('/', validate(schemas.createRequisition), async (req, res) => {
  const { orgId, id: actorId } = req.officer;
  const { title, description, amount, currency, supplier_id } = req.body;

  try {
    // Guard: if supplier_id provided, ensure supplier is not blacklisted
    if (supplier_id) {
      const sup = await db.withOrg(orgId, async (client) =>
        client.query(
          'SELECT id, is_blacklisted FROM suppliers WHERE id = $1 AND org_id = $2',
          [supplier_id, orgId]
        )
      );
      if (!sup.rows.length) return res.status(404).json({ error: 'Supplier not found' });
      if (sup.rows[0].is_blacklisted) {
        return res.status(422).json({ error: 'Supplier is blacklisted and cannot be engaged' });
      }
    }

    const result = await db.withOrg(orgId, async (client) => {
      const inserted = await client.query(
        `INSERT INTO requisitions
           (org_id, ref_number, title, description, amount, currency, supplier_id, created_by)
         VALUES ($1, '', $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [orgId, title, description || null, amount, currency, supplier_id || null, actorId]
      );

      const req_ = inserted.rows[0];
      await audit.log(client, {
        orgId,
        actorId,
        tableName: 'requisitions',
        recordId: req_.id,
        action: 'INSERT',
        payload: { ref_number: req_.ref_number, title, amount, currency, status: 'Draft' },
      });

      return req_;
    });

    return res.status(201).json(result);
  } catch (err) {
    console.error('[requisitions/create]', err);
    return res.status(500).json({ error: 'Failed to create requisition' });
  }
});

// ─── PATCH /api/requisitions/:id/status ──────────────────────────────────────
// Status machine transitions with role enforcement.
router.patch(
  '/:id/status',
  validate(schemas.updateRequisitionStatus),
  async (req, res) => {
    const { orgId, id: actorId, role } = req.officer;
    const { status: newStatus, note } = req.body;

    // Role-based transition rules
    const allowed = {
      Officer: ['Delivered'],          // Officers report deliveries via API or WhatsApp
      Manager: ['Approved', 'Disputed'],
      Executive: ['Approved', 'Ordered', 'Disputed'],
      Auditor: [],                      // Auditors are read-only
    };

    if (!allowed[role]?.includes(newStatus)) {
      return res.status(403).json({
        error: `Role '${role}' cannot transition a requisition to '${newStatus}'`,
      });
    }

    try {
      const result = await db.withOrg(orgId, async (client) => {
        const current = await client.query(
          'SELECT * FROM requisitions WHERE id = $1 AND org_id = $2',
          [req.params.id, orgId]
        );
        if (!current.rows.length) {
          throw Object.assign(new Error('Requisition not found'), { status: 404 });
        }

        const req_ = current.rows[0];

        // Valid transitions
        const transitions = {
          Draft: ['Approved'],
          Approved: ['Ordered', 'Disputed'],
          Ordered: ['Delivered', 'Disputed'],
          Delivered: ['Paid', 'Disputed'],
          Paid: [],
          Disputed: ['Approved'],
        };

        if (!transitions[req_.status]?.includes(newStatus)) {
          throw Object.assign(
            new Error(`Cannot transition from '${req_.status}' to '${newStatus}'`),
            { status: 422 }
          );
        }

        // Paid transition: must have a confirmed delivery AND a payment record
        if (newStatus === 'Paid') {
          const payment = await client.query(
            'SELECT id FROM payments WHERE requisition_id = $1 LIMIT 1',
            [req_.id]
          );
          if (!payment.rows.length) {
            throw Object.assign(
              new Error('Cannot mark as Paid — no payment record linked to this requisition'),
              { status: 422 }
            );
          }
        }

        const updated = await client.query(
          `UPDATE requisitions SET status = $1, updated_at = NOW()
           WHERE id = $2 RETURNING *`,
          [newStatus, req_.id]
        );

        await audit.log(client, {
          orgId,
          actorId,
          tableName: 'requisitions',
          recordId: req_.id,
          action: 'UPDATE',
          payload: {
            from_status: req_.status,
            to_status: newStatus,
            note: note || null,
          },
        });

        return updated.rows[0];
      });

      return res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      console.error('[requisitions/status]', err);
      return res.status(500).json({ error: 'Failed to update status' });
    }
  }
);

// ─── PATCH /api/requisitions/:id ─────────────────────────────────────────────
// Edit Draft-only fields (title, description, amount, supplier).
router.patch('/:id', async (req, res) => {
  const { orgId, id: actorId, role } = req.officer;

  if (!['Officer', 'Manager', 'Executive'].includes(role)) {
    return res.status(403).json({ error: 'Auditors cannot edit requisitions' });
  }

  const allowed = ['title', 'description', 'amount', 'currency', 'supplier_id'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'No updatable fields provided' });
  }

  try {
    const result = await db.withOrg(orgId, async (client) => {
      const current = await client.query(
        'SELECT * FROM requisitions WHERE id = $1 AND org_id = $2',
        [req.params.id, orgId]
      );
      if (!current.rows.length) throw Object.assign(new Error('Not found'), { status: 404 });

      const req_ = current.rows[0];
      if (req_.status !== 'Draft') {
        throw Object.assign(new Error('Only Draft requisitions can be edited'), { status: 422 });
      }
      if (role === 'Officer' && req_.created_by !== actorId) {
        throw Object.assign(new Error('You can only edit your own requisitions'), { status: 403 });
      }

      const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 1}`);
      const values = [...Object.values(updates), req_.id];
      const updated = await client.query(
        `UPDATE requisitions SET ${setClauses.join(', ')}, updated_at = NOW()
         WHERE id = $${values.length} RETURNING *`,
        values
      );

      await audit.log(client, {
        orgId, actorId,
        tableName: 'requisitions',
        recordId: req_.id,
        action: 'UPDATE',
        payload: updates,
      });

      return updated.rows[0];
    });

    return res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[requisitions/edit]', err);
    return res.status(500).json({ error: 'Failed to update requisition' });
  }
});

// ─── GET /api/requisitions/:id/audit ─────────────────────────────────────────
router.get('/:id/audit', requireRole('Manager', 'Executive', 'Auditor'), async (req, res) => {
  const { orgId } = req.officer;

  try {
    const result = await db.withOrg(orgId, async (client) => {
      return client.query(
        `SELECT al.*, o.full_name AS actor_name
         FROM audit_log al
         LEFT JOIN officers o ON o.id = al.actor_id
         WHERE al.org_id = $1 AND al.table_name = 'requisitions' AND al.record_id = $2
         ORDER BY al.id ASC`,
        [orgId, req.params.id]
      );
    });

    return res.json(result.rows);
  } catch (err) {
    console.error('[requisitions/audit]', err);
    return res.status(500).json({ error: 'Failed to fetch audit trail' });
  }
});

module.exports = router;
