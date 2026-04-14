'use strict';
const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// ─── GET /api/reports/incident/:requisitionId ────────────────────────────────
// Generate a JSON incident report for a requisition. (Executive only)
router.get('/incident/:requisitionId', requireRole('Executive'), async (req, res) => {
  const { orgId } = req.officer;

  try {
    const report = await db.withOrg(orgId, async (client) => {
      // 1. Fetch requisition details
      const reqRes = await client.query(
        `SELECT r.*,
                o.full_name AS requester_name,
                a.full_name AS approver_name,
                s.name      AS supplier_name,
                s.compliance_score AS supplier_score
         FROM requisitions r
         LEFT JOIN officers  o ON o.id = r.created_by
         LEFT JOIN officers  a ON a.id = r.approved_by
         LEFT JOIN suppliers s ON s.id = r.supplier_id
         WHERE r.id = $1 AND r.org_id = $2`,
        [req.params.requisitionId, orgId]
      );

      if (!reqRes.rows.length) {
        throw Object.assign(new Error('Requisition not found'), { status: 404 });
      }

      const requisition = reqRes.rows[0];

      // 2. Fetch audit trail for this requisition
      const auditRes = await client.query(
        `SELECT al.*, o.full_name AS actor_name
         FROM audit_log al
         LEFT JOIN officers o ON o.id = al.actor_id
         WHERE al.org_id = $1 AND al.table_name = 'requisitions' AND al.record_id = $2
         ORDER BY al.id ASC`,
        [orgId, requisition.id]
      );

      // 3. Fetch any open or unacknowledged escalations
      const escRes = await client.query(
        `SELECT * FROM escalations
         WHERE org_id = $1 AND requisition_id = $2
         ORDER BY triggered_at ASC`,
        [orgId, requisition.id]
      );

      // 4. Fetch delivery and payment if they exist
      const delRes = await client.query(
        'SELECT * FROM deliveries WHERE requisition_id = $1',
        [requisition.id]
      );
      const payRes = await client.query(
        'SELECT * FROM payments WHERE requisition_id = $1',
        [requisition.id]
      );

      return {
        generated_at: new Date().toISOString(),
        summary: {
          ref_number: requisition.ref_number,
          title: requisition.title,
          status: requisition.status,
          amount_total: `${requisition.amount} ${requisition.currency}`,
          supplier: requisition.supplier_name,
          compliance_risk: requisition.supplier_score < 50 ? 'HIGH' : (requisition.supplier_score < 80 ? 'MEDIUM' : 'LOW'),
        },
        chronology: auditRes.rows.map(a => ({
          timestamp: a.created_at,
          actor: a.actor_name || 'SYSTEM',
          action: a.action,
          details: a.payload,
        })),
        sla_performance: {
          sla_deadline: requisition.sla_deadline,
          ordered_at: requisition.ordered_at,
          escalations: escRes.rows.map(e => ({
            tier: e.tier,
            triggered_at: e.triggered_at,
            acknowledged_at: e.acknowledged_at,
            is_overdue: e.auto_escalated_at !== null,
          })),
        },
        delivery_verification: delRes.rows.map(d => ({
          confirmed_at: d.created_at,
          photo_url: d.photo_url,
          location: d.gps_lat ? `${d.gps_lat}, ${d.gps_lng}` : 'N/A',
          notes: d.notes,
        })),
        payment_info: payRes.rows.map(p => ({
          paid_at: p.created_at,
          reference: p.payment_reference,
          amount: `${p.amount} ${p.currency}`,
        })),
      };
    });

    return res.json(report);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[reports/incident]', err);
    return res.status(500).json({ error: 'Failed to generate incident report' });
  }
});

module.exports = router;
