'use strict';
const express = require('express');
const db = require('../db');
const audit = require('../services/audit');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');

const router = express.Router();
router.use(authenticate);

// ─── POST /api/payments ───────────────────────────────────────────────────────
// Create a payment record. The DB constraint enforces:
//   - delivery_id is NOT NULL (FK)
//   - delivery belongs to the same requisition (trigger)
// This API additionally verifies the requisition is in 'Delivered' status.
router.post(
  '/',
  requireRole('Manager', 'Executive'),
  validate(schemas.createPayment),
  async (req, res) => {
    const { orgId, id: actorId } = req.officer;
    const { requisition_id, delivery_id, amount, currency, payment_reference, notes } = req.body;

    try {
      const result = await db.withOrg(orgId, async (client) => {
        // Verify requisition exists and is Delivered
        const req_ = await client.query(
          'SELECT * FROM requisitions WHERE id = $1 AND org_id = $2',
          [requisition_id, orgId]
        );
        if (!req_.rows.length) {
          throw Object.assign(new Error('Requisition not found'), { status: 404 });
        }
        if (req_.rows[0].status !== 'Delivered') {
          throw Object.assign(
            new Error(`Payment requires 'Delivered' requisition (current: ${req_.rows[0].status})`),
            { status: 422 }
          );
        }

        // Verify delivery belongs to this org
        const del_ = await client.query(
          'SELECT * FROM deliveries WHERE id = $1 AND org_id = $2',
          [delivery_id, orgId]
        );
        if (!del_.rows.length) {
          throw Object.assign(new Error('Delivery not found'), { status: 404 });
        }

        // DB trigger (check_payment_delivery_match) will enforce delivery ↔ requisition linkage
        const inserted = await client.query(
          `INSERT INTO payments
             (org_id, requisition_id, delivery_id, amount, currency,
              payment_reference, notes, paid_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [orgId, requisition_id, delivery_id, amount, currency || 'ZMW',
           payment_reference || null, notes || null, actorId]
        );

        const payment = inserted.rows[0];

        // Advance requisition to Paid
        await client.query(
          `UPDATE requisitions SET status = 'Paid', updated_at = NOW() WHERE id = $1`,
          [requisition_id]
        );

        await audit.log(client, {
          orgId, actorId,
          tableName: 'payments',
          recordId: payment.id,
          action: 'INSERT',
          payload: {
            requisition_id,
            delivery_id,
            amount,
            currency: currency || 'ZMW',
            payment_reference: payment_reference || null,
          },
        });

        await audit.log(client, {
          orgId, actorId,
          tableName: 'requisitions',
          recordId: requisition_id,
          action: 'UPDATE',
          payload: { from_status: 'Delivered', to_status: 'Paid', payment_id: payment.id },
        });

        return payment;
      });

      return res.status(201).json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      // Propagate DB constraint violation messages cleanly
      if (err.code === 'P0001') return res.status(422).json({ error: err.message });
      console.error('[payments/create]', err);
      return res.status(500).json({ error: 'Failed to record payment' });
    }
  }
);

// ─── GET /api/payments/:id ────────────────────────────────────────────────────
router.get('/:id', requireRole('Manager', 'Executive', 'Auditor'), async (req, res) => {
  const { orgId } = req.officer;

  try {
    const result = await db.withOrg(orgId, async (client) =>
      client.query(
        `SELECT p.*,
                r.ref_number   AS requisition_ref,
                r.title        AS requisition_title,
                o.full_name    AS paid_by_name
         FROM payments p
         JOIN requisitions r ON r.id = p.requisition_id
         JOIN officers     o ON o.id = p.paid_by
         WHERE p.id = $1 AND p.org_id = $2`,
        [req.params.id, orgId]
      )
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Payment not found' });
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('[payments/get]', err);
    return res.status(500).json({ error: 'Failed to fetch payment' });
  }
});

// ─── GET /api/payments?requisition_id=xxx ────────────────────────────────────
router.get('/', requireRole('Manager', 'Executive', 'Auditor'), async (req, res) => {
  const { orgId } = req.officer;
  const { requisition_id } = req.query;

  if (!requisition_id) {
    return res.status(400).json({ error: 'requisition_id query param is required' });
  }

  try {
    const result = await db.withOrg(orgId, async (client) =>
      client.query(
        `SELECT p.*, o.full_name AS paid_by_name
         FROM payments p
         JOIN officers o ON o.id = p.paid_by
         WHERE p.requisition_id = $1 AND p.org_id = $2
         ORDER BY p.created_at DESC`,
        [requisition_id, orgId]
      )
    );

    return res.json(result.rows);
  } catch (err) {
    console.error('[payments/list]', err);
    return res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

module.exports = router;
