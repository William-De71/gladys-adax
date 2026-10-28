// -----------------------------------------------------------------------------
// One Gladys device per Adax room (the API controls rooms, not heaters), with
// these features:
//
//   key                 category / type                   unit          writable
//   target_temperature  thermostat / target-temperature   celsius       yes (5-35, 1)
//   mode                thermostat / mode                 -             yes (off, heating)
//   temperature         temperature-sensor / decimal      celsius       no
//   operating_state     thermostat / operating-state      -             no  (idle, heating)
//   power               energy-sensor / power             watt          no
//   energy              energy-sensor / index             kilowatt-hour no
//
// The last three exist only when the heaters of the room report their energy.
// `operating_state` and `power` are the average between two readings: the
// room heated (or not) since the previous one. `energy` is the index the
// integration cumulates (src/adax.js), the one Gladys turns into a
// consumption and a cost.
//
// The feature keys, categories, types, units and bounds are forever (the
// Discovery "Update" button compares them): see test/structure.test.js.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { THERMOSTAT_MODE, THERMOSTAT_OPERATING_STATE } from './constants.js';
import { TEMPERATURE_RANGE } from './adax.js';
import { t } from './i18n.js';

const DEVICE_TYPE = 'room';

const writable = { read_only: false, has_feedback: true };
const readOnly = { read_only: true, has_feedback: false };

// Order = order of the features in Gladys. `present` decides from the parsed
// room; `value` gives the state (null: nothing to publish).
const FEATURES = [
  {
    key: 'target_temperature',
    category: CATEGORIES.THERMOSTAT,
    type: TYPES.THERMOSTAT.TARGET_TEMPERATURE,
    unit: UNITS.CELSIUS,
    min: TEMPERATURE_RANGE.min,
    max: TEMPERATURE_RANGE.max,
    step: TEMPERATURE_RANGE.step,
    ...writable,
    present: () => true,
    value: (m) => m.target,
  },
  {
    key: 'mode',
    category: CATEGORIES.THERMOSTAT,
    type: TYPES.THERMOSTAT.MODE,
    min: THERMOSTAT_MODE.OFF,
    max: THERMOSTAT_MODE.HEATING,
    ...writable,
    supported_options: [
      { value: THERMOSTAT_MODE.OFF, label: 'Off' },
      { value: THERMOSTAT_MODE.HEATING, label: 'Heating' },
    ],
    present: () => true,
    value: (m) =>
      m.heatingEnabled === null
        ? null
        : m.heatingEnabled
          ? THERMOSTAT_MODE.HEATING
          : THERMOSTAT_MODE.OFF,
  },
  {
    key: 'temperature',
    category: CATEGORIES.TEMPERATURE_SENSOR,
    type: TYPES.SENSOR.DECIMAL,
    unit: UNITS.CELSIUS,
    min: -20,
    max: 60,
    ...readOnly,
    present: () => true,
    value: (m) => m.temperature,
  },
  {
    key: 'operating_state',
    category: CATEGORIES.THERMOSTAT,
    type: TYPES.THERMOSTAT.OPERATING_STATE,
    min: THERMOSTAT_OPERATING_STATE.IDLE,
    max: THERMOSTAT_OPERATING_STATE.COOLING,
    ...readOnly,
    present: (m) => m.hasEnergy,
    value: (m) => {
      if (m.heatingEnabled === false) return THERMOSTAT_OPERATING_STATE.IDLE;
      if (m.powerW === null || m.powerW === undefined) return null;
      return m.powerW > 0 ? THERMOSTAT_OPERATING_STATE.HEATING : THERMOSTAT_OPERATING_STATE.IDLE;
    },
  },
  {
    key: 'power',
    category: CATEGORIES.ENERGY_SENSOR,
    type: TYPES.ENERGY_SENSOR.POWER,
    unit: UNITS.WATT,
    min: 0,
    max: 10000,
    ...readOnly,
    present: (m) => m.hasEnergy,
    value: (m) => (m.powerW === null || m.powerW === undefined ? null : m.powerW),
  },
  {
    key: 'energy',
    category: CATEGORIES.ENERGY_SENSOR,
    type: TYPES.ENERGY_SENSOR.INDEX,
    unit: UNITS.KILOWATT_HOUR,
    min: 0,
    max: 10000000,
    ...readOnly,
    present: (m) => m.hasEnergy,
    value: (m) =>
      m.energyKwh === null || m.energyKwh === undefined
        ? null
        : Math.round(m.energyKwh * 1000) / 1000,
  },
];
const FEATURE_KEYS = FEATURES.map((feature) => feature.key);

/**
 * @description The ids of an Adax room. The Adax id is a number; it is
 * URI-encoded anyway so a colon could never cut a feature id.
 * @param {object} gladys - The Gladys client (externalIds).
 * @param {string} id - The Adax room id.
 * @returns {{ device: string, feature: Function }} The ids.
 */
function idsOf(gladys, id) {
  return gladys.externalIds(DEVICE_TYPE, encodeURIComponent(id));
}

/**
 * @description The features a room has.
 * @param {object} model - A parsed room.
 * @returns {object[]} The feature specs.
 */
function featuresOf(model) {
  return FEATURES.filter((feature) => feature.present(model));
}

/**
 * @description The name of a room: its Adax name, followed by the home when
 * the account has several homes ("Living room (Cabin)").
 * @param {object} model - A parsed room.
 * @param {boolean} [withHome] - Add the home name.
 * @returns {string} The name.
 */
function deviceName(model, withHome = false) {
  const name = model.name || `Adax ${model.id}`;
  return withHome && model.homeName ? `${name} (${model.homeName})` : name;
}

/**
 * @description The Discovery payload of a room.
 * @param {object} gladys - The Gladys client.
 * @param {object} model - A parsed room.
 * @param {string} language - Language of the feature names.
 * @param {boolean} [withHome] - Add the home to the name.
 * @returns {object} The device.
 */
function buildDevice(gladys, model, language = 'en', withHome = false) {
  const ids = idsOf(gladys, model.id);
  return {
    name: deviceName(model, withHome),
    external_id: ids.device,
    model: 'Adax',
    should_poll: false,
    params: [
      { name: 'ADAX_HOME', value: model.homeName || model.homeId || 'unknown' },
      { name: 'ADAX_HEATERS', value: String(model.heaters.length) },
    ],
    features: featuresOf(model).map((feature) => {
      // eslint-disable-next-line no-unused-vars
      const { key, present, value, ...fields } = feature;
      return {
        ...fields,
        name: t(`feature_${key}`, language),
        external_id: ids.feature(key),
      };
    }),
  };
}

/**
 * @description Whether a room is offered in Discovery: a room with a heater,
 * or one Adax gives a setpoint for.
 * @param {object} model - A parsed room.
 * @returns {boolean} Publishable.
 */
function isPublishable(model) {
  return model.heaters.length > 0 || model.target !== null;
}

/**
 * @description The states of a room.
 * @param {object} gladys - The Gladys client.
 * @param {object} model - A parsed room.
 * @returns {Array<{device_feature_external_id: string, state: number}>} The states.
 */
function buildStates(gladys, model) {
  const ids = idsOf(gladys, model.id);
  return featuresOf(model).flatMap((feature) => {
    const state = feature.value(model);
    return state === null || state === undefined
      ? []
      : [{ device_feature_external_id: ids.feature(feature.key), state }];
  });
}

/**
 * @description What Discovery would compare: a change republishes the list.
 * @param {object} gladys - The Gladys client.
 * @param {object[]} models - Parsed rooms.
 * @param {string} language - Language of the feature names.
 * @param {boolean} withHome - Add the home to the names.
 * @returns {string} A signature.
 */
function discoverySignature(gladys, models, language, withHome) {
  return JSON.stringify(
    models.map((model) => {
      const device = buildDevice(gladys, model, language, withHome);
      return [device.external_id, device.name, device.features.map((f) => f.name)];
    }),
  );
}

export {
  DEVICE_TYPE,
  FEATURES,
  FEATURE_KEYS,
  idsOf,
  featuresOf,
  deviceName,
  buildDevice,
  isPublishable,
  buildStates,
  discoverySignature,
};
