// -----------------------------------------------------------------------------
// The Adax data model: the content of the API -> one parsed room per Adax
// room, the encoding of the commands, and the energy accounting.
//
// The API controls ROOMS, not heaters: a room has a setpoint, a measured
// temperature and heating on / off, shared by all its heaters. Temperatures
// travel as hundredths of a degree (2150 = 21.5 °C), 5 to 35 °C.
//
// Energy: with `?withEnergy=1`, every heater carries `energyWh` and
// `energyTime` (ms). Adax documents it as the consumption "for the past hour";
// what the Home Assistant users see is a saw tooth that grows during the hour
// and drops back to 0 when a new hour starts (home-assistant/core#150994). So
// the energy used between two readings is:
//   - same hour as the previous reading: the increase of `energyWh`;
//   - a new hour (or a drop): the whole `energyWh`, counted since the start of
//     the hour (the end of the previous hour after our last reading is lost:
//     a few % at a 2-minute interval).
// The integration adds these to a cumulated index per room, kept in /data.
// -----------------------------------------------------------------------------

const TEMPERATURE_RANGE = { min: 5, max: 35, step: 1 };
// Setpoint used to switch a room on when Adax gives none.
const DEFAULT_TARGET = 20;
const HOUR_MS = 60 * 60 * 1000;
// More than this in one reading of one heater is a glitch, not a consumption
// (an Adax heater draws 2.5 kW at most).
const MAX_HEATER_WH_PER_READING = 4000;
// A power is computed over this span at least (shorter: too noisy).
const MIN_POWER_SPAN_MS = 60 * 1000;

const hourOf = (ms) => Math.floor(ms / HOUR_MS);

/**
 * @description A number of the API, or null.
 * @param {unknown} value - The raw value (number or numeric string).
 * @returns {number|null} The number.
 */
function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * @description Hundredths of a degree -> °C rounded to 0.1, or null.
 * @param {unknown} raw - The raw value.
 * @returns {number|null} °C.
 */
function decodeTemperature(raw) {
  const n = numberOrNull(raw);
  return n === null ? null : Math.round(n / 10) / 10;
}

/**
 * @description A setpoint -> the value Adax takes (whole °C, in hundredths).
 * @param {number} celsius - The setpoint.
 * @returns {number} Hundredths of a degree.
 * @throws {RangeError} Not a number, or outside 5–35 °C.
 */
function encodeTarget(celsius) {
  const value = Number(celsius);
  if (!Number.isFinite(value)) throw new RangeError('The setpoint must be a number');
  const rounded = Math.round(value / TEMPERATURE_RANGE.step) * TEMPERATURE_RANGE.step;
  if (rounded < TEMPERATURE_RANGE.min || rounded > TEMPERATURE_RANGE.max) {
    throw new RangeError(
      `The setpoint must be between ${TEMPERATURE_RANGE.min} and ${TEMPERATURE_RANGE.max} °C`,
    );
  }
  return Math.round(rounded * 100);
}

/**
 * @description Parse the content of the API into rooms.
 * @param {object} content - `{ homes, rooms, devices }`.
 * @returns {object[]} The rooms: `{ id, homeId, homeName, name, heatingEnabled,
 *   target, temperature, heaters: [{ id, name, type, energyWh, energyTime }],
 *   hasEnergy }`.
 */
function parseContent(content) {
  const homes = new Map();
  for (const home of Array.isArray(content?.homes) ? content.homes : []) {
    if (home?.id !== undefined && home?.id !== null) {
      homes.set(String(home.id), typeof home.name === 'string' ? home.name.trim() : '');
    }
  }
  const heaters = new Map();
  for (const device of Array.isArray(content?.devices) ? content.devices : []) {
    if (device?.id === undefined || device?.id === null) continue;
    const roomId = String(device.roomId ?? '');
    const list = heaters.get(roomId) ?? [];
    list.push({
      id: String(device.id),
      name: typeof device.name === 'string' ? device.name.trim() : '',
      type: typeof device.type === 'string' ? device.type : '',
      energyWh: numberOrNull(device.energyWh),
      energyTime: numberOrNull(device.energyTime),
    });
    heaters.set(roomId, list);
  }
  const rooms = [];
  for (const room of Array.isArray(content?.rooms) ? content.rooms : []) {
    if (room?.id === undefined || room?.id === null) continue;
    const id = String(room.id);
    const homeId = room.homeId === undefined || room.homeId === null ? '' : String(room.homeId);
    const roomHeaters = (heaters.get(id) ?? []).sort((a, b) => a.id.localeCompare(b.id));
    rooms.push({
      id,
      homeId,
      homeName: homes.get(homeId) ?? '',
      name: typeof room.name === 'string' ? room.name.trim() : '',
      heatingEnabled: typeof room.heatingEnabled === 'boolean' ? room.heatingEnabled : null,
      target: decodeTemperature(room.targetTemperature),
      temperature: decodeTemperature(room.temperature),
      heaters: roomHeaters,
      hasEnergy: roomHeaters.some((heater) => heater.energyWh !== null),
    });
  }
  return rooms;
}

/**
 * @description The energy one heater used since its previous reading.
 * @param {{wh: number, time: number|null}|null} previous - The previous
 *   reading (null: the first one, which only sets the baseline).
 * @param {{energyWh: number|null, energyTime: number|null}} heater - The heater.
 * @param {number} readAt - When the reading was made (ms), used when Adax
 *   gives no `energyTime`.
 * @returns {{ deltaWh: number, powerW: number|null, hour: number, record: object|null }}
 *   The energy used, the average power over the span (null: unknown), the
 *   hour (ms / 1 h) it belongs to, and the reading to remember.
 */
function heaterEnergy(previous, heater, readAt) {
  const wh = heater.energyWh;
  const time = heater.energyTime ?? readAt;
  const hour = hourOf(time);
  if (wh === null || wh < 0) return { deltaWh: 0, powerW: null, hour, record: previous };
  const record = { wh, time };
  if (!previous) return { deltaWh: 0, powerW: null, hour, record };
  // An older or identical reading: nothing new.
  if (time <= previous.time) return { deltaWh: 0, powerW: null, hour, record: previous };
  const newHour = hourOf(previous.time) !== hour || wh < previous.wh;
  let deltaWh = newHour ? wh : wh - previous.wh;
  const span = newHour ? time - hour * HOUR_MS : time - previous.time;
  if (deltaWh > MAX_HEATER_WH_PER_READING) deltaWh = 0;
  const powerW = span >= MIN_POWER_SPAN_MS ? Math.round(deltaWh / (span / HOUR_MS)) : null;
  return { deltaWh, powerW, hour, record };
}

/**
 * @description The energy of a room since its previous reading.
 * @param {object} previous - Heater id -> previous reading.
 * @param {object} room - A parsed room.
 * @param {number} readAt - When the reading was made (ms).
 * @returns {{ deltaWh: number, powerW: number|null, byHour: Map<number, number>, heaters: object }}
 *   The energy, the power (sum of the heaters with a known power, null when
 *   none), the energy per hour, and the readings to remember.
 */
function roomEnergy(previous, room, readAt) {
  const heaters = {};
  const byHour = new Map();
  let deltaWh = 0;
  let powerW = null;
  for (const heater of room.heaters) {
    const result = heaterEnergy(previous?.[heater.id] ?? null, heater, readAt);
    if (result.record) heaters[heater.id] = result.record;
    deltaWh += result.deltaWh;
    if (result.deltaWh > 0) {
      byHour.set(result.hour, (byHour.get(result.hour) ?? 0) + result.deltaWh);
    }
    if (result.powerW !== null) powerW = (powerW ?? 0) + result.powerW;
  }
  return { deltaWh, powerW, byHour, heaters };
}

/**
 * @description The room changes of a command, ready for /rest/v1/control/.
 * @param {object} room - The parsed room.
 * @param {{ heatingEnabled?: boolean, target?: number }} change - The change.
 * @returns {object} `{ id, heatingEnabled, targetTemperature? }`.
 */
function controlRoom(room, change) {
  const heatingEnabled =
    change.heatingEnabled ?? (change.target !== undefined ? true : room.heatingEnabled);
  if (heatingEnabled === false) return { id: Number(room.id), heatingEnabled: false };
  const target = change.target ?? room.target ?? DEFAULT_TARGET;
  return {
    id: Number(room.id),
    heatingEnabled: true,
    targetTemperature: encodeTarget(target),
  };
}

export {
  TEMPERATURE_RANGE,
  DEFAULT_TARGET,
  HOUR_MS,
  MAX_HEATER_WH_PER_READING,
  hourOf,
  decodeTemperature,
  encodeTarget,
  parseContent,
  heaterEnergy,
  roomEnergy,
  controlRoom,
};
