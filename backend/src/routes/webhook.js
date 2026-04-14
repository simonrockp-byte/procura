'use strict';
/**
 * WhatsApp Webhook — Meta Cloud API
 *
 * Two endpoints:
 *   GET  /api/webhook/whatsapp  — Meta verification handshake
 *   POST /api/webhook/whatsapp  — Inbound message handler
 *
 * Message handling flow:
 *   1. Verify X-Hub-Signature-256 against WHATSAPP_APP_SECRET
 *   2. Identify officer by phone number (E.164)
 *   3. Parse structured command (e.g. "REQ-0003 DELIVERED arrived safely")
 *   4. Execute the command against the database
 *   5. Reply via Meta Send Message API
 */
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const audit = require('../services/audit');
const wa = require('../services/whatsapp');
const config = require('../config');

const router = express.Router();

// ─── GET — Meta webhook verification ─────────────────────────────────────────
router.get('/whatsapp', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
    console.log('[webhook] WhatsApp verification successful');
    return res.status(200).send(challenge);
  }
  return res.status(403).json({ error: 'Verification failed' });
});

// ─── POST — Inbound messages ──────────────────────────────────────────────────
router.post('/whatsapp', express.json(), async (req, res) => {
  // 1. Verify signature
  if (!verifySignature(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Acknowledge immediately — Meta requires a 200 within 20 s
  res.status(200).json({ status: 'ok' });

  // 2. Extract message from payload
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (!value?.messages?.length) return; // status update or non-message event

    const message = value.messages[0];
    if (message.type !== 'text') {
      // Non-text message (image, voice note) — acknowledge but don't process
      await tryReply(value, message.from, '⚠️ Only text commands are supported. Send HELP for a list.');
      return;
    }

    const fromPhone = normalisePhone(message.from);
    const text = message.text.body;

    // 3. Identify officer by phone number (search across all orgs for this number)
    const officerResult = await db.query(
      `SELECT o.*, org.wa_phone_number_id, org.wa_access_token_enc
       FROM officers o
       JOIN organisations org ON org.id = o.org_id
       WHERE o.phone_number = $1 AND o.is_active = TRUE
       LIMIT 1`,
      [fromPhone]
    );

    if (!officerResult.rows.length) {
      await tryReply(value, message.from,
        '❌ Your number is not registered in Procura. Contact your administrator.');
      return;
    }

    const officer = officerResult.rows[0];

    // 4. Parse command
    const parsed = wa.parseCommand(text);

    // 5. Execute
    await handleCommand(parsed, officer, message.from, value);

  } catch (err) {
    console.error('[webhook] processing error:', err);
  }
});

// ─── Command handlers ─────────────────────────────────────────────────────────

async function handleCommand(parsed, officer, replyTo, value) {
  const orgId = officer.org_id;
  const actorId = officer.id;
  const send = (msg) => tryReply(value, replyTo, msg);

  switch (parsed.command) {
    case 'HELP':
      return send(wa.HELP_TEXT);

    case 'LIST':
      return handleList(orgId, actorId, officer.role, send);

    case 'STATUS':
      return handleStatus(orgId, parsed.ref, send);

    case 'DELIVERED':
      return handleDelivered(orgId, actorId, officer, parsed, send);

    case 'DISPUTE':
      return handleDispute(orgId, actorId, parsed, send);

    case 'PAID':
      return handlePaid(orgId, actorId, officer.role, parsed, send);

    default:
      return send(
        `❓ Unknown command.\n${parsed.hint || ''}\nSend HELP for a list of commands.`
      );
  }
}

async function handleList(orgId, officerId, role, send) {
  try {
    const result = await db.withOrg(orgId, async (client) => {
      const conditions = [`r.org_id = $1`, `r.status NOT IN ('Paid', 'Disputed')`];
      const params = [orgId];
      if (role === 'Officer') {
        conditions.push(`r.created_by = $2`);
        params.push(officerId);
      }
      return client.query(
        `SELECT ref_number, title, status, sla_deadline
         FROM requisitions r
         WHERE ${conditions.join(' AND ')}
         ORDER BY created_at DESC LIMIT 10`,
        params
      );
    });

    if (!result.rows.length) return send('✅ No open requisitions found.');

    const lines = result.rows.map((r) => {
      const overdue = r.sla_deadline && new Date(r.sla_deadline) < new Date() ? ' ⚠️ OVERDUE' : '';
      return `*${r.ref_number}* — ${r.status}${overdue}\n  ${r.title}`;
    });

    return send(`📋 *Open Requisitions*\n\n${lines.join('\n\n')}`);
  } catch (err) {
    console.error('[webhook/list]', err);
    return send('❌ Failed to retrieve requisitions.');
  }
}

async function handleStatus(orgId, ref, send) {
  try {
    const result = await db.withOrg(orgId, async (client) =>
      client.query(
        `SELECT r.*, s.name AS supplier_name
         FROM requisitions r
         LEFT JOIN suppliers s ON s.id = r.supplier_id
         WHERE r.ref_number = $1 AND r.org_id = $2`,
        [ref, orgId]
      )
    );

    if (!result.rows.length) return send(`❌ Requisition *${ref}* not found.`);

    const r = result.rows[0];
    const deadline = r.sla_deadline
      ? `\n⏰ SLA Deadline: ${new Date(r.sla_deadline).toUTCString()}`
      : '';
    const supplier = r.supplier_name ? `\n🏢 Supplier: ${r.supplier_name}` : '';

    return send(
      `📄 *${r.ref_number}*\n` +
      `Title: ${r.title}\n` +
      `Status: *${r.status}*\n` +
      `Amount: ${r.currency} ${Number(r.amount).toLocaleString()}` +
      supplier + deadline
    );
  } catch (err) {
    console.error('[webhook/status]', err);
    return send('❌ Failed to fetch status.');
  }
}

async function handleDelivered(orgId, actorId, officer, parsed, send) {
  if (officer.role === 'Auditor') {
    return send('❌ Auditors cannot confirm deliveries.');
  }

  try {
    await db.withOrg(orgId, async (client) => {
      const req_ = await client.query(
        `SELECT * FROM requisitions WHERE ref_number = $1 AND org_id = $2`,
        [parsed.ref, orgId]
      );

      if (!req_.rows.length) {
        throw Object.assign(new Error(`Requisition *${parsed.ref}* not found.`), { user: true });
      }

      const r = req_.rows[0];
      if (r.status !== 'Ordered') {
        throw Object.assign(
          new Error(`*${parsed.ref}* is *${r.status}* — only Ordered requisitions can be delivered.`),
          { user: true }
        );
      }

      // Create delivery record
      const del = await client.query(
        `INSERT INTO deliveries (org_id, requisition_id, confirmed_by, notes)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [orgId, r.id, actorId, parsed.notes || null]
      );

      // Advance status
      await client.query(
        `UPDATE requisitions SET status = 'Delivered', updated_at = NOW() WHERE id = $1`,
        [r.id]
      );

      await audit.log(client, {
        orgId, actorId,
        tableName: 'deliveries',
        recordId: del.rows[0].id,
        action: 'INSERT',
        payload: { source: 'whatsapp', requisition_id: r.id, notes: parsed.notes },
      });

      await audit.log(client, {
        orgId, actorId,
        tableName: 'requisitions',
        recordId: r.id,
        action: 'UPDATE',
        payload: { from_status: 'Ordered', to_status: 'Delivered', source: 'whatsapp' },
      });
    });

    return send(
      `✅ Delivery confirmed for *${parsed.ref}*.\nStatus updated to *Delivered*.\n` +
      `Reference logged. A manager will process payment.`
    );
  } catch (err) {
    if (err.user) return send(`❌ ${err.message}`);
    console.error('[webhook/delivered]', err);
    return send('❌ Failed to record delivery. Please try again or contact your manager.');
  }
}

async function handleDispute(orgId, actorId, parsed, send) {
  try {
    await db.withOrg(orgId, async (client) => {
      const req_ = await client.query(
        `SELECT * FROM requisitions WHERE ref_number = $1 AND org_id = $2`,
        [parsed.ref, orgId]
      );

      if (!req_.rows.length) {
        throw Object.assign(new Error(`Requisition *${parsed.ref}* not found.`), { user: true });
      }

      const r = req_.rows[0];
      if (['Paid', 'Disputed'].includes(r.status)) {
        throw Object.assign(
          new Error(`*${parsed.ref}* is already *${r.status}* and cannot be disputed.`),
          { user: true }
        );
      }

      await client.query(
        `UPDATE requisitions SET status = 'Disputed', updated_at = NOW() WHERE id = $1`,
        [r.id]
      );

      await audit.log(client, {
        orgId, actorId,
        tableName: 'requisitions',
        recordId: r.id,
        action: 'UPDATE',
        payload: {
          from_status: r.status,
          to_status: 'Disputed',
          reason: parsed.reason,
          source: 'whatsapp',
        },
      });
    });

    return send(
      `⚠️ Dispute raised for *${parsed.ref}*.\nReason: _${parsed.reason}_\n` +
      `Your manager has been notified.`
    );
  } catch (err) {
    if (err.user) return send(`❌ ${err.message}`);
    console.error('[webhook/dispute]', err);
    return send('❌ Failed to raise dispute.');
  }
}

async function handlePaid(orgId, actorId, role, parsed, send) {
  if (!['Manager', 'Executive'].includes(role)) {
    return send('❌ Only Managers and Executives can record payments.');
  }

  try {
    await db.withOrg(orgId, async (client) => {
      const req_ = await client.query(
        `SELECT * FROM requisitions WHERE ref_number = $1 AND org_id = $2`,
        [parsed.ref, orgId]
      );

      if (!req_.rows.length) {
        throw Object.assign(new Error(`Requisition *${parsed.ref}* not found.`), { user: true });
      }

      const r = req_.rows[0];
      if (r.status !== 'Delivered') {
        throw Object.assign(
          new Error(`Payment requires *Delivered* status (current: *${r.status}*).`),
          { user: true }
        );
      }

      // Get the linked delivery
      const del_ = await client.query(
        `SELECT id FROM deliveries WHERE requisition_id = $1 LIMIT 1`,
        [r.id]
      );
      if (!del_.rows.length) {
        throw Object.assign(new Error('No delivery record found for this requisition.'), { user: true });
      }

      const payment = await client.query(
        `INSERT INTO payments
           (org_id, requisition_id, delivery_id, amount, currency, payment_reference, notes, paid_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [orgId, r.id, del_.rows[0].id, r.amount, r.currency,
         parsed.paymentRef || null, parsed.notes || null, actorId]
      );

      await client.query(
        `UPDATE requisitions SET status = 'Paid', updated_at = NOW() WHERE id = $1`,
        [r.id]
      );

      await audit.log(client, {
        orgId, actorId,
        tableName: 'payments',
        recordId: payment.rows[0].id,
        action: 'INSERT',
        payload: {
          requisition_id: r.id,
          amount: r.amount,
          currency: r.currency,
          payment_reference: parsed.paymentRef,
          source: 'whatsapp',
        },
      });

      await audit.log(client, {
        orgId, actorId,
        tableName: 'requisitions',
        recordId: r.id,
        action: 'UPDATE',
        payload: { from_status: 'Delivered', to_status: 'Paid', source: 'whatsapp' },
      });
    });

    return send(
      `✅ Payment recorded for *${parsed.ref}*.\n` +
      (parsed.paymentRef ? `Payment Ref: ${parsed.paymentRef}\n` : '') +
      `Status updated to *Paid*.`
    );
  } catch (err) {
    if (err.user) return send(`❌ ${err.message}`);
    if (err.code === 'P0001') return send(`❌ ${err.message}`);
    console.error('[webhook/paid]', err);
    return send('❌ Failed to record payment.');
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function verifySignature(req) {
  if (!config.whatsapp.appSecret) return true; // skip in dev if not set

  const sig = req.headers['x-hub-signature-256'];
  if (!sig) return false;

  const expected = 'sha256=' +
    crypto
      .createHmac('sha256', config.whatsapp.appSecret)
      .update(JSON.stringify(req.body))
      .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

function normalisePhone(phone) {
  // Meta sends numbers without '+', e.g. "260971234567"
  return phone.startsWith('+') ? phone : `+${phone}`;
}

async function tryReply(value, to, text) {
  try {
    // Use the org's credentials if available (stored in the officer row join)
    await wa.sendText(to, text);
  } catch (err) {
    console.error('[webhook] reply failed:', err.message);
  }
}

module.exports = router;
