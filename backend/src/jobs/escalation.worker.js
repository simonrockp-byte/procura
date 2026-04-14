'use strict';
/**
 * Escalation Worker — Bull Queue processor
 *
 * Two recurring jobs (registered in jobs/index.js):
 *   - 'check-overdue'    : every hour  — finds newly overdue requisitions
 *   - 'auto-escalate'    : every 15 min — advances unacknowledged escalations
 */
const escalationService = require('../services/escalation');

async function processCheckOverdue(job) {
  console.log('[worker] running check-overdue …');
  await escalationService.triggerOverdueEscalations();
  console.log('[worker] check-overdue complete');
}

async function processAutoEscalate(job) {
  console.log('[worker] running auto-escalate …');
  await escalationService.autoEscalateUnacknowledged();
  console.log('[worker] auto-escalate complete');
}

module.exports = { processCheckOverdue, processAutoEscalate };
