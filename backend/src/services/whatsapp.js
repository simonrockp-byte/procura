'use strict';
/**
 * WhatsApp Cloud API helper — Meta Graph API v19.0
 * Sends text replies to officers via the registered phone number.
 */
const https = require('https');
const config = require('../config');

/**
 * Send a text message via Meta's WhatsApp Cloud API.
 *
 * @param {string} to             Recipient phone in E.164 e.g. +260971234567
 * @param {string} text           Message body
 * @param {string} [accessToken]  Org-specific token; falls back to env default
 * @param {string} [phoneNumberId] Org-specific phone number ID; falls back to env default
 */
async function sendText(to, text, accessToken, phoneNumberId) {
  const token = accessToken || config.whatsapp.accessToken;
  const pnid  = phoneNumberId || config.whatsapp.phoneNumberId;

  const body = JSON.stringify({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: false, body: text },
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'graph.facebook.com',
        path: `/v19.0/${pnid}/messages`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`WhatsApp API ${res.statusCode}: ${data}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Structured command parser ────────────────────────────────────────────────
// Supported commands (case-insensitive):
//   REQ-XXXX STATUS
//   REQ-XXXX DELIVERED [optional notes]
//   REQ-XXXX DISPUTE <reason>
//   REQ-XXXX PAID ref:<payment-ref> [notes]
//   LIST
//   HELP

const REF_PATTERN = /^(REQ-\d{4,})\s+(\S+)(.*)$/i;

function parseCommand(messageText) {
  const text = messageText.trim();

  if (/^HELP$/i.test(text)) return { command: 'HELP' };
  if (/^LIST$/i.test(text)) return { command: 'LIST' };

  const match = text.match(REF_PATTERN);
  if (!match) return { command: 'UNKNOWN', raw: text };

  const ref = match[1].toUpperCase();
  const verb = match[2].toUpperCase();
  const rest = match[3].trim();

  switch (verb) {
    case 'STATUS':
      return { command: 'STATUS', ref };

    case 'DELIVERED':
    case 'DELIVERY':
      return { command: 'DELIVERED', ref, notes: rest || null };

    case 'DISPUTE':
    case 'DISPUTED':
      if (!rest) return { command: 'UNKNOWN', raw: text, hint: 'DISPUTE requires a reason' };
      return { command: 'DISPUTE', ref, reason: rest };

    case 'PAID':
    case 'PAYMENT': {
      const refMatch = rest.match(/ref:(\S+)/i);
      const payRef = refMatch ? refMatch[1] : null;
      const notes = rest.replace(/ref:\S+/i, '').trim() || null;
      return { command: 'PAID', ref, paymentRef: payRef, notes };
    }

    default:
      return { command: 'UNKNOWN', raw: text };
  }
}

const HELP_TEXT = `*Procura WhatsApp Commands*

REQ-XXXX STATUS — check status
REQ-XXXX DELIVERED [notes] — confirm delivery
REQ-XXXX DISPUTE <reason> — flag a dispute
REQ-XXXX PAID ref:<ref> [notes] — record payment
LIST — your open requisitions
HELP — this message`;

module.exports = { sendText, parseCommand, HELP_TEXT };
