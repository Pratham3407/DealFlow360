/**
 * Deal-health sweep timer.
 *
 * Runs the detectors on an interval so STALLED / DISCOUNT_ANOMALY /
 * DELIVERY_SLIPPAGE findings appear without a human pressing "sweep". The sweep is
 * idempotent (findings are fingerprinted), so a timer re-run is safe.
 *
 * The actor carries no `userId`: there is no user behind a timer, and
 * `audit_logs.actor_user_id` is nullable precisely so background work can
 * attribute itself by label instead.
 */

import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { runDealHealthSweep } from './deal-health.service.js';
import type { AuditActor } from '../audit/audit.service.js';

const SYSTEM_ACTOR: AuditActor = { label: 'deal-health-scheduler' };

export function startScheduler(): NodeJS.Timeout {
  const intervalMs = env.DEAL_HEALTH_SWEEP_MINUTES * 60 * 1000;

  async function tick() {
    try {
      const events = await db.transaction((tx) => runDealHealthSweep(tx, SYSTEM_ACTOR));
      logger.info('Deal-health sweep complete', { events: events.length });
    } catch (err) {
      logger.error('Deal-health sweep failed', { err });
    }
  }

  void tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return timer;
}