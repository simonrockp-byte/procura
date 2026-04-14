'use strict';
/**
 * Bull Queue setup — registers escalation jobs and starts the worker.
 * Run separately from the API server: `node src/jobs/index.js`
 *
 * Queues:
 *   escalation-queue
 *     - check-overdue  : cron every 1 hour
 *     - auto-escalate  : cron every 15 minutes
 */
const Bull = require('bull');
const config = require('../config');
const { processCheckOverdue, processAutoEscalate } = require('./escalation.worker');

const escalationQueue = new Bull('escalation-queue', {
  redis: config.redis.url,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 200,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  },
});

// ─── Register processors ──────────────────────────────────────────────────────
escalationQueue.process('check-overdue', processCheckOverdue);
escalationQueue.process('auto-escalate', processAutoEscalate);

// ─── Schedule recurring jobs (idempotent — skip if already scheduled) ─────────
async function scheduleJobs() {
  // Remove stale repeatable jobs first so rescheduling is idempotent
  const existing = await escalationQueue.getRepeatableJobs();
  for (const job of existing) {
    await escalationQueue.removeRepeatableByKey(job.key);
  }

  // Check for newly overdue requisitions every hour
  await escalationQueue.add(
    'check-overdue',
    {},
    { repeat: { cron: '0 * * * *' } }
  );

  // Auto-escalate unacknowledged alerts every 15 minutes
  await escalationQueue.add(
    'auto-escalate',
    {},
    { repeat: { cron: '*/15 * * * *' } }
  );

  console.log('[jobs] Escalation jobs scheduled:');
  console.log('  check-overdue  → every hour (0 * * * *)');
  console.log('  auto-escalate  → every 15 min (*/15 * * * *)');
}

// ─── Event hooks ──────────────────────────────────────────────────────────────
escalationQueue.on('completed', (job) => {
  console.log(`[jobs] ${job.name} completed (id=${job.id})`);
});

escalationQueue.on('failed', (job, err) => {
  console.error(`[jobs] ${job.name} failed (id=${job.id}):`, err.message);
});

escalationQueue.on('error', (err) => {
  console.error('[jobs] queue error:', err.message);
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
process.on('SIGTERM', async () => {
  console.log('[jobs] SIGTERM — draining queue …');
  await escalationQueue.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await escalationQueue.close();
  process.exit(0);
});

scheduleJobs().catch((err) => {
  console.error('[jobs] failed to schedule jobs:', err);
  process.exit(1);
});

module.exports = { escalationQueue };
