// -----------------------------------------------------------------------------
// Scene triggers and scene actions.
//
// Triggers fire on a TRANSITION between two readings of a room, never on a
// snapshot: the first reading of a room only sets its baseline. The last
// values are kept in /data across restarts (state.js), so a change made while
// the integration restarted still fires once, and nothing fires twice.
// A change the integration itself asked for (a feature, a scene action, a
// widget button) never fires: a scene bound to it would loop. These triggers
// tell what was done in the Adax WiFi app or on the heater.
// -----------------------------------------------------------------------------

const TRIGGERS = {
  HEATING_TURNED_ON: 'heating_turned_on',
  HEATING_TURNED_OFF: 'heating_turned_off',
  SETPOINT_CHANGED: 'setpoint_changed',
};

const SCENE_ACTIONS = {
  SET_TEMPERATURE: 'set_temperature',
  SET_HEATING: 'set_heating',
  REFRESH: 'refresh',
};

/**
 * @description What is remembered of a room between two readings.
 * @param {object} model - A parsed room.
 * @returns {{ heating: boolean|null, target: number|null }} The snapshot.
 */
function snapshotOf(model) {
  return { heating: model.heatingEnabled, target: model.target };
}

/**
 * @description The scene events of a new reading of a room.
 * @param {object|null} previous - The snapshot of the previous reading (null:
 *   first reading, nothing fires).
 * @param {object} model - The parsed room.
 * @param {object} context - Context.
 * @param {string} context.device - The Gladys external id of the room.
 * @param {string} context.name - The room name.
 * @param {Function} context.isExpected - `({ heating } | { target }) =>
 *   boolean`: the integration asked for this value.
 * @returns {{ events: Array<{key: string, data: object}>, snapshot: object }} The events.
 */
function detectEvents(previous, model, context) {
  const snapshot = snapshotOf(model);
  const events = [];
  if (!previous) return { events, snapshot };
  const base = {
    device: context.device,
    device_name: context.name,
    temperature: model.temperature,
    target_temperature: model.target,
  };

  if (
    previous.heating !== null &&
    snapshot.heating !== null &&
    previous.heating !== snapshot.heating &&
    !context.isExpected({ heating: snapshot.heating })
  ) {
    events.push({
      key: snapshot.heating ? TRIGGERS.HEATING_TURNED_ON : TRIGGERS.HEATING_TURNED_OFF,
      data: base,
    });
  }
  if (
    previous.target !== null &&
    snapshot.target !== null &&
    previous.target !== snapshot.target &&
    !context.isExpected({ target: snapshot.target })
  ) {
    events.push({
      key: TRIGGERS.SETPOINT_CHANGED,
      data: { ...base, previous_target: previous.target },
    });
  }
  return { events, snapshot };
}

/**
 * @description Read the "on / off" field of the set_heating action.
 * @param {unknown} raw - The resolved field value.
 * @returns {boolean} Heating on.
 * @throws {RangeError} Neither on nor off.
 */
function parseHeating(raw) {
  const text = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (['on', 'true', '1'].includes(text)) return true;
  if (['off', 'false', '0'].includes(text)) return false;
  throw new RangeError(`"${String(raw).slice(0, 20)}" is neither on nor off`);
}

export { TRIGGERS, SCENE_ACTIONS, snapshotOf, detectEvents, parseHeating };
