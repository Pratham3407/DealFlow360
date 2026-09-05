/**
 * Load typed engine settings from the `system_settings` table.
 *
 * This is the read path for the configuration knobs. Defaults live in
 * `settings.ts`; rows in the table override them per key. Returns an object
 * shaped exactly like the canonical settings so callers never touch a string map.
 */

import { systemSettings } from '@/db/schema/index.js';
import type { DbExecutor } from '@/db/client.js';
import { resolveSettings } from './settings.js';

export async function loadSettingsMap(exec: DbExecutor) {
  const rows = await exec.select().from(systemSettings);

  const overrides = new Map<string, string>();
  for (const row of rows) {
    overrides.set(row.key, row.value);
  }

  return resolveSettings(overrides);
}

export type RuntimeSettings = ReturnType<typeof loadSettingsMap>;
export type { RiskWeights } from '../risk/risk-engine.js';