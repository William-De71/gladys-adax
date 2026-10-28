// -----------------------------------------------------------------------------
// What the integration remembers across restarts, in /data/state.json (mode
// 0600, the only writable place of the container):
//   - `snapshots`: per Adax room, the values the scene triggers compare
//     (heating on / off, setpoint);
//   - `energy`: per Adax room, the cumulated index (kWh) and the last energy
//     reading of each of its heaters (src/adax.js);
//   - `hours`: per Adax room, the energy of each of the last 48 hours (Wh,
//     keyed by the hour number since 1970), for the energy widget.
// A missing or unreadable file is an empty state: nothing fires on the first
// reading, the index starts from 0 (Gladys only uses its increases).
// -----------------------------------------------------------------------------

import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DEFAULT_PATH = '/data/state.json';
// Hours of history kept per room.
const KEPT_HOURS = 49;

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * @description Create the store.
 * @param {object} [options] - Options.
 * @param {string|null} [options.path] - The file (null: memory only, tests).
 * @param {object} [options.logger] - Logger.
 * @returns {object} The store.
 */
function createState({ path = DEFAULT_PATH, logger = null } = {}) {
  let data = { snapshots: {}, energy: {}, hours: {} };
  let dirty = false;

  if (path) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      data = {
        snapshots: isObject(parsed?.snapshots) ? parsed.snapshots : {},
        energy: isObject(parsed?.energy) ? parsed.energy : {},
        hours: isObject(parsed?.hours) ? parsed.hours : {},
      };
    } catch (err) {
      if (err.code !== 'ENOENT') logger?.warn(`Unreadable ${path}, starting afresh`);
    }
  }

  return {
    snapshot: (id) => data.snapshots[id] ?? null,
    setSnapshot(id, snapshot) {
      if (JSON.stringify(data.snapshots[id]) === JSON.stringify(snapshot)) return;
      data.snapshots[id] = snapshot;
      dirty = true;
    },
    /**
     * @param {string} id - The room id.
     * @returns {{kwh: number, heaters: object}|null} Its energy record.
     */
    energy: (id) => data.energy[id] ?? null,
    setEnergy(id, record) {
      if (JSON.stringify(data.energy[id]) === JSON.stringify(record)) return;
      data.energy[id] = record;
      dirty = true;
    },
    /**
     * @description Add energy to the hours of a room, and drop the old hours.
     * @param {string} id - The room id.
     * @param {Map<number, number>} byHour - Hour number -> Wh.
     * @param {number} currentHour - The current hour number.
     */
    addHours(id, byHour, currentHour) {
      const hours = { ...(data.hours[id] ?? {}) };
      for (const [hour, wh] of byHour) {
        if (hour <= currentHour - KEPT_HOURS) continue;
        hours[hour] = Math.round(((hours[hour] ?? 0) + wh) * 10) / 10;
      }
      for (const hour of Object.keys(hours)) {
        if (Number(hour) <= currentHour - KEPT_HOURS) delete hours[hour];
      }
      if (JSON.stringify(hours) === JSON.stringify(data.hours[id] ?? {})) return;
      data.hours[id] = hours;
      dirty = true;
    },
    /**
     * @param {string} id - The room id.
     * @returns {object} Hour number -> Wh.
     */
    hours: (id) => data.hours[id] ?? {},
    /**
     * @description Drop the rooms Adax no longer lists.
     * @param {string[]} ids - The ids to keep.
     */
    keep(ids) {
      const wanted = new Set(ids);
      for (const bucket of [data.snapshots, data.energy, data.hours]) {
        for (const id of Object.keys(bucket)) {
          if (!wanted.has(id)) {
            delete bucket[id];
            dirty = true;
          }
        }
      }
    },
    /** @description Write the file when something changed (atomically). */
    save() {
      if (!dirty || !path) return;
      try {
        mkdirSync(dirname(path), { recursive: true });
        const temporary = `${path}.tmp`;
        writeFileSync(temporary, JSON.stringify(data), { mode: 0o600 });
        renameSync(temporary, path);
        dirty = false;
      } catch (err) {
        logger?.warn(`Unable to write ${path}: ${err.message}`);
      }
    },
  };
}

export { DEFAULT_PATH, KEPT_HOURS, createState };
