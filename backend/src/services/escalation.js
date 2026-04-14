'use strict';
/**
 * Escalation Service
 *
 * Called by the Bull worker. Two responsibilities:
 *
 * 1. triggerOverdueEscalations()
 *    Finds all requisitions in 'Ordered' status whose sla_deadline has passed
 *    and that have no active (unacknowledged) escalation at the current tier.
 *    Creates an escalation record and notifies the relevant tier via WhatsApp.
 *
 * 2. autoEscalateUnacknowledged()
 *    Finds escalations that have been unacknowledged for > 2 hours and have
 *    not yet reached the Executive tier. Advances them to the next tier.
 */
const db = require('../db');
const audit = require('./audit');
const wa = require('./whatsapp');
const config = require('../config');

const TIER_ORDER = ['Officer', 'Manager', 'Executive'];

function nextTier(current) {
  const idx = TIER_ORDER.indexOf(current);
  return idx < TIER_ORDER.length - 1 ? TIER_ORDER[idx + 1] : null;
}

// ─── 1. Trigger new escalations for overdue requisitions ─────────────────────

async function triggerOverdueEscalations() {
  // Find all orgs that have overdue Ordered requisitions
  const overdueResult = await db.query(
    `SELECT r.id AS req_id, r.org_id, r.ref_number, r.title, r.sla_deadline,
            r.created_by, o.full_name AS officer_name, o.phone_number AS officer_phone,
            org.sla_hours
     FROM requisitions r
     JOIN officers o ON o.id = r.created_by
     JOIN organisations org ON org.id = r.org_id
     WHERE r.status = 'Ordered'
       AND r.sla_deadline < NOW()
       AND r.id NOT IN (
         SELECT DISTINCT requisition_id
         FROM escalations
         WHERE acknowledged_at IS NULL
       )`,
    []
  );

  for (const row of overdueResult.rows) {
    try {
      await createEscalation(row, 'Officer');
    } catch (err) {
      console.error(`[escalation] failed for req ${row.ref_number}:`, err.message);
    }
  }

  console.log(`[escalation] triggered ${overdueResult.rows.length} new escalation(s)`);
}

// ─── 2. Auto-escalate unacknowledged escalations ─────────────────────────────

async function autoEscalateUnacknowledged() {
  const cutoff = new Date(
    Date.now() - config.escalation.autoEscalateHours * 60 * 60 * 1000
  ).toISOString();

  const stale = await db.query(
    `SELECT e.*, r.ref_number, r.title, r.org_id AS r_org_id
     FROM escalations e
     JOIN requisitions r ON r.id = e.requisition_id
     WHERE e.acknowledged_at IS NULL
       AND e.triggered_at < $1
       AND e.tier != 'Executive'`,
    [cutoff]
  );

  for (const esc of stale.rows) {
    const next = nextTier(esc.tier);
    if (!next) continue;

    try {
      await db.withOrg(esc.org_id, async (client) => {
        // Mark current escalation as auto-escalated
        await client.query(
          `UPDATE escalations SET auto_escalated_at = NOW() WHERE id = $1`,
          [esc.id]
        );

        await audit.log(client, {
          orgId: esc.org_id,
          actorId: null,
          tableName: 'escalations',
          recordId: esc.id,
          action: 'SYSTEM',
          payload: { event: 'auto_escalated', from_tier: esc.tier, to_tier: next },
        });
      });

      // Create next-tier escalation
      await createEscalation(
        {
          req_id: esc.requisition_id,
          org_id: esc.org_id,
          ref_number: esc.ref_number,
          title: esc.title,
        },
        next,
        esc.id
      );

      console.log(`[escalation] auto-escalated ${esc.ref_number}: ${esc.tier} → ${next}`);
    } catch (err) {
      console.error(`[escalation] auto-escalate failed for ${esc.ref_number}:`, err.message);
    }
  }
}

// ─── Internal: create escalation record + notify ──────────────────────────────

async function createEscalation(req, tier, fromEscalationId = null) {
  const orgId = req.org_id;

  await db.withOrg(orgId, async (client) => {
    // Create escalation row
    const inserted = await client.query(
      `INSERT INTO escalations (org_id, requisition_id, tier, triggered_at)
       VALUES ($1, $2, $3, NOW()) RETURNING *`,
      [orgId, req.req_id, tier]
    );

    const esc = inserted.rows[0];

    await audit.log(client, {
      orgId,
      actorId: null,
      tableName: 'escalations',
      recordId: esc.id,
      action: 'SYSTEM',
      payload: {
        event: 'escalation_created',
        requisition_id: req.req_id,
        ref_number: req.ref_number,
        tier,
        from_escalation_id: fromEscalationId,
      },
    });

    // Notify the correct tier via WhatsApp
    await notifyTier(client, orgId, tier, req);
  });
}

async function notifyTier(client, orgId, tier, req) {
  // Find officers of the target tier to notify
  const recipients = await client.query(
    `SELECT phone_number, full_name FROM officers
     WHERE org_id = $1 AND role = $2 AND is_active = TRUE AND phone_number IS NOT NULL`,
    [orgId, tier]
  );

  const overdueSince = req.sla_deadline
    ? `SLA expired: ${new Date(req.sla_deadline).toUTCString()}`
    : 'SLA threshold exceeded';

  const message =
    `🚨 *Procura Escalation Alert* [${tier}]\n\n` +
    `Requisition *${req.ref_number}* is overdue.\n` +
    `Title: ${req.title}\n` +
    `${overdueSince}\n\n` +
    `Reply with "${req.ref_number} STATUS" for details.\n` +
    `This alert will auto-escalate if unacknowledged within ` +
    `${config.escalation.autoEscalateHours} hour(s).`;

  for (const officer of recipients.rows) {
    try {
      await wa.sendText(officer.phone_number, message);
    } catch (err) {
      console.error(`[escalation] notify failed for ${officer.phone_number}:`, err.message);
    }
  }
}

// ─── Acknowledge an escalation ────────────────────────────────────────────────

async function acknowledge(orgId, escalationId, officerId) {
  return db.withOrg(orgId, async (client) => {
    const esc = await client.query(
      `SELECT * FROM escalations WHERE id = $1 AND org_id = $2`,
      [escalationId, orgId]
    );

    if (!esc.rows.length) throw Object.assign(new Error('Escalation not found'), { status: 404 });
    if (esc.rows[0].acknowledged_at) {
      throw Object.assign(new Error('Escalation already acknowledged'), { status: 409 });
    }

    const updated = await client.query(
      `UPDATE escalations
       SET acknowledged_by = $1, acknowledged_at = NOW()
       WHERE id = $2 RETURNING *`,
      [officerId, escalationId]
    );

    await audit.log(client, {
      orgId,
      actorId: officerId,
      tableName: 'escalations',
      recordId: escalationId,
      action: 'UPDATE',
      payload: { event: 'acknowledged', tier: esc.rows[0].tier },
    });

    return updated.rows[0];
  });
}

module.exports = { triggerOverdueEscalations, autoEscalateUnacknowledged, acknowledge };
