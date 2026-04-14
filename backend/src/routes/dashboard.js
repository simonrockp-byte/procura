'use strict';
/**
 * Dashboard API — read-only aggregates for the compliance dashboard.
 *
 * All endpoints require Manager / Executive / Auditor role.
 *
 * GET /api/dashboard/summary          — top-level KPIs
 * GET /api/dashboard/requisitions     — requisitions by status (for chart)
 * GET /api/dashboard/officer-activity — officer-level activity summary
 * GET /api/dashboard/vendor-performance — supplier compliance overview
 * GET /api/dashboard/escalations      — open and recent escalations
 * GET /api/dashboard/audit/verify     — verify audit log hash chain integrity
 * POST /api/dashboard/escalations/:id/acknowledge — acknowledge an escalation
 */
const express = require('express');
const db = require('../db');
const escalationService = require('../services/escalation');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');

const router = express.Router();
router.use(authenticate, requireRole('Manager', 'Executive', 'Auditor'));

// ─── GET /api/dashboard/summary ──────────────────────────────────────────────
router.get('/summary', async (req, res) => {
  const { orgId } = req.officer;

  try {
    const result = await db.withOrg(orgId, async (client) => {
      const [
        statusCounts,
        overdueCount,
        escalationCount,
        blacklistedSuppliers,
        recentPayments,
        disputedCount,
      ] = await Promise.all([
        // Requisitions by status
        client.query(
          `SELECT status, COUNT(*) AS count
           FROM requisitions WHERE org_id = $1
           GROUP BY status`,
          [orgId]
        ),
        // Overdue (Ordered + past SLA)
        client.query(
          `SELECT COUNT(*) AS count FROM requisitions
           WHERE org_id = $1 AND status = 'Ordered' AND sla_deadline < NOW()`,
          [orgId]
        ),
        // Open escalations
        client.query(
          `SELECT COUNT(*) AS count FROM escalations
           WHERE org_id = $1 AND acknowledged_at IS NULL`,
          [orgId]
        ),
        // Blacklisted suppliers
        client.query(
          `SELECT COUNT(*) AS count FROM suppliers
           WHERE org_id = $1 AND is_blacklisted = TRUE`,
          [orgId]
        ),
        // Payments in last 30 days
        client.query(
          `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
           FROM payments
           WHERE org_id = $1 AND created_at >= NOW() - INTERVAL '30 days'`,
          [orgId]
        ),
        // Disputed
        client.query(
          `SELECT COUNT(*) AS count FROM requisitions
           WHERE org_id = $1 AND status = 'Disputed'`,
          [orgId]
        ),
      ]);

      const byStatus = {};
      for (const row of statusCounts.rows) {
        byStatus[row.status] = parseInt(row.count);
      }

      return {
        requisitions: {
          by_status: byStatus,
          total: Object.values(byStatus).reduce((a, b) => a + b, 0),
          overdue: parseInt(overdueCount.rows[0].count),
          disputed: parseInt(disputedCount.rows[0].count),
        },
        escalations: {
          open: parseInt(escalationCount.rows[0].count),
        },
        suppliers: {
          blacklisted: parseInt(blacklistedSuppliers.rows[0].count),
        },
        payments_30d: {
          total_amount: parseFloat(recentPayments.rows[0].total),
          count: parseInt(recentPayments.rows[0].count),
        },
      };
    });

    return res.json(result);
  } catch (err) {
    console.error('[dashboard/summary]', err);
    return res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// ─── GET /api/dashboard/officer-activity ─────────────────────────────────────
router.get('/officer-activity', async (req, res) => {
  const { orgId } = req.officer;
  const { days = 30 } = req.query;

  try {
    const result = await db.withOrg(orgId, async (client) =>
      client.query(
        `SELECT
           o.id,
           o.full_name,
           o.role,
           o.last_login_at,
           COUNT(DISTINCT r.id)  FILTER (WHERE r.created_at >= NOW() - ($2 || ' days')::INTERVAL)
             AS requisitions_created,
           COUNT(DISTINCT d.id)  FILTER (WHERE d.created_at >= NOW() - ($2 || ' days')::INTERVAL)
             AS deliveries_confirmed,
           COUNT(DISTINCT p.id)  FILTER (WHERE p.created_at >= NOW() - ($2 || ' days')::INTERVAL)
             AS payments_processed
         FROM officers o
         LEFT JOIN requisitions r ON r.created_by = o.id AND r.org_id = o.org_id
         LEFT JOIN deliveries   d ON d.confirmed_by = o.id AND d.org_id = o.org_id
         LEFT JOIN payments     p ON p.paid_by = o.id AND p.org_id = o.org_id
         WHERE o.org_id = $1 AND o.is_active = TRUE
         GROUP BY o.id, o.full_name, o.role, o.last_login_at
         ORDER BY requisitions_created DESC`,
        [orgId, days.toString()]
      )
    );

    return res.json(result.rows);
  } catch (err) {
    console.error('[dashboard/officer-activity]', err);
    return res.status(500).json({ error: 'Failed to fetch officer activity' });
  }
});

// ─── GET /api/dashboard/vendor-performance ────────────────────────────────────
router.get('/vendor-performance', async (req, res) => {
  const { orgId } = req.officer;

  try {
    const result = await db.withOrg(orgId, async (client) =>
      client.query(
        `SELECT
           s.id,
           s.name,
           s.compliance_score,
           s.is_blacklisted,
           s.document_expiry,
           COUNT(DISTINCT r.id)  AS total_requisitions,
           COUNT(DISTINCT r.id) FILTER (WHERE r.status = 'Paid')      AS paid_count,
           COUNT(DISTINCT r.id) FILTER (WHERE r.status = 'Disputed')  AS disputed_count,
           COUNT(DISTINCT r.id) FILTER (WHERE r.status = 'Delivered') AS delivered_count,
           COALESCE(SUM(p.amount), 0) AS total_paid_amount
         FROM suppliers s
         LEFT JOIN requisitions r ON r.supplier_id = s.id AND r.org_id = s.org_id
         LEFT JOIN payments     p ON p.requisition_id = r.id
         WHERE s.org_id = $1
         GROUP BY s.id, s.name, s.compliance_score, s.is_blacklisted, s.document_expiry
         ORDER BY s.compliance_score DESC, total_requisitions DESC`,
        [orgId]
      )
    );

    return res.json(result.rows);
  } catch (err) {
    console.error('[dashboard/vendor-performance]', err);
    return res.status(500).json({ error: 'Failed to fetch vendor performance' });
  }
});

// ─── GET /api/dashboard/escalations ──────────────────────────────────────────
router.get('/escalations', async (req, res) => {
  const { orgId } = req.officer;

  try {
    const result = await db.withOrg(orgId, async (client) =>
      client.query(
        `SELECT
           e.*,
           r.ref_number, r.title AS requisition_title, r.status AS requisition_status,
           r.sla_deadline,
           ack.full_name AS acknowledged_by_name
         FROM escalations e
         JOIN requisitions r ON r.id = e.requisition_id
         LEFT JOIN officers ack ON ack.id = e.acknowledged_by
         WHERE e.org_id = $1
         ORDER BY e.triggered_at DESC
         LIMIT 100`,
        [orgId]
      )
    );

    const open = result.rows.filter((r) => !r.acknowledged_at);
    const resolved = result.rows.filter((r) => r.acknowledged_at);

    return res.json({ open, resolved: resolved.slice(0, 20) });
  } catch (err) {
    console.error('[dashboard/escalations]', err);
    return res.status(500).json({ error: 'Failed to fetch escalations' });
  }
});

// ─── POST /api/dashboard/escalations/:id/acknowledge ─────────────────────────
router.post(
  '/escalations/:id/acknowledge',
  requireRole('Manager', 'Executive'),
  async (req, res) => {
    const { orgId, id: officerId } = req.officer;

    try {
      const updated = await escalationService.acknowledge(orgId, req.params.id, officerId);
      return res.json(updated);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      console.error('[dashboard/acknowledge]', err);
      return res.status(500).json({ error: 'Failed to acknowledge escalation' });
    }
  }
);

// ─── GET /api/dashboard/audit/verify ─────────────────────────────────────────
// Verifies the SHA-256 hash chain for this organisation's audit log.
router.get('/audit/verify', requireRole('Executive', 'Auditor'), async (req, res) => {
  const { orgId } = req.officer;
  const audit = require('../services/audit');

  try {
    const result = await db.withOrg(orgId, async (client) => audit.verify(client, orgId));
    return res.json(result);
  } catch (err) {
    console.error('[dashboard/audit/verify]', err);
    return res.status(500).json({ error: 'Verification failed' });
  }
});

// ─── GET /api/dashboard/audit/log ────────────────────────────────────────────
router.get('/audit/log', requireRole('Executive', 'Auditor'), async (req, res) => {
  const { orgId } = req.officer;
  const { table, record_id, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    const result = await db.withOrg(orgId, async (client) => {
      const conditions = ['al.org_id = $1'];
      const params = [orgId];
      let idx = 2;

      if (table) { conditions.push(`al.table_name = $${idx++}`); params.push(table); }
      if (record_id) { conditions.push(`al.record_id = $${idx++}`); params.push(record_id); }

      params.push(parseInt(limit), offset);
      const where = conditions.join(' AND ');

      return client.query(
        `SELECT al.*, o.full_name AS actor_name
         FROM audit_log al
         LEFT JOIN officers o ON o.id = al.actor_id
         WHERE ${where}
         ORDER BY al.id DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        params
      );
    });

    return res.json(result.rows);
  } catch (err) {
    console.error('[dashboard/audit/log]', err);
    return res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

module.exports = router;
