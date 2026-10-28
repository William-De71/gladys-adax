// The traps of the Gladys core that the fake Gladys does not catch
// (community feedback, thread 11005): a device is only polled with
// should_poll AND poll_frequency, every feature needs min / max / read_only /
// has_feedback, a wrong category / type pair shows no icon nor label, and a
// single invalid field rejects the whole discovery batch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';

import { parseContent } from '../src/adax.js';
import { buildDevice, buildStates, isPublishable, FEATURE_KEYS } from '../src/device.js';
import { THERMOSTAT_MODE, THERMOSTAT_OPERATING_STATE } from '../src/constants.js';
import { LANGUAGES } from '../src/i18n.js';
import { CONTENT, LIVING, variant, fakeGladys } from './helpers/fixtures.js';

// A parsed room as app.js keeps it: with its power and energy index.
const model = (room, extra = {}) => ({ powerW: null, energyKwh: null, ...room, ...extra });
const rooms = parseContent(CONTENT).map((room) => model(room, { powerW: 1200, energyKwh: 3.5 }));
const devices = (language) =>
  rooms.filter(isPublishable).map((room) => buildDevice(fakeGladys, room, language));
const keysOf = (room) =>
  buildDevice(fakeGladys, room).features.map((f) => f.external_id.split(':').pop());
const statesOf = (room) =>
  Object.fromEntries(
    buildStates(fakeGladys, room).map((s) => [
      s.device_feature_external_id.split(':').pop(),
      s.state,
    ]),
  );

// DEVICE_FEATURE_UNITS_BY_CATEGORY of the Gladys core 5.3.0
// (server/utils/constants.js), and the pairs the front labels
// (front/src/config/i18n: deviceFeatureCategory.<category>.<type>).
const UNITS_OF = {
  [CATEGORIES.THERMOSTAT]: [UNITS.CELSIUS, UNITS.FAHRENHEIT],
  [CATEGORIES.TEMPERATURE_SENSOR]: [UNITS.CELSIUS, UNITS.FAHRENHEIT, UNITS.KELVIN],
  [CATEGORIES.ENERGY_SENSOR]: [UNITS.WATT, UNITS.KILOWATT, UNITS.KILOWATT_HOUR, UNITS.WATT_HOUR],
};
// thermostat mode / operating-state carry no unit in the core.
const NO_UNIT = [TYPES.THERMOSTAT.MODE, TYPES.THERMOSTAT.OPERATING_STATE];
const PAIRS = [
  [CATEGORIES.THERMOSTAT, TYPES.THERMOSTAT.TARGET_TEMPERATURE],
  [CATEGORIES.THERMOSTAT, TYPES.THERMOSTAT.MODE],
  [CATEGORIES.THERMOSTAT, TYPES.THERMOSTAT.OPERATING_STATE],
  [CATEGORIES.TEMPERATURE_SENSOR, TYPES.SENSOR.DECIMAL],
  [CATEGORIES.ENERGY_SENSOR, TYPES.ENERGY_SENSOR.POWER],
  [CATEGORIES.ENERGY_SENSOR, TYPES.ENERGY_SENSOR.INDEX],
];
const WRITABLE = ['target_temperature', 'mode'];

test('rooms are never polled by Gladys: the integration has its own clock', () => {
  for (const device of devices('en')) {
    assert.equal(device.should_poll, false, device.external_id);
    assert.equal(device.poll_frequency, undefined);
  }
});

test('every feature carries min, max, read_only and has_feedback, in every language', () => {
  for (const language of LANGUAGES) {
    for (const device of devices(language)) {
      for (const feature of device.features) {
        for (const key of ['min', 'max']) {
          assert.equal(typeof feature[key], 'number', `${feature.external_id}.${key}`);
        }
        assert.ok(feature.min <= feature.max, feature.external_id);
        const key = feature.external_id.split(':').pop();
        assert.equal(feature.read_only, !WRITABLE.includes(key), feature.external_id);
        assert.equal(feature.has_feedback, WRITABLE.includes(key), feature.external_id);
        assert.ok(feature.name, feature.external_id);
        for (const field of ['present', 'value', 'key']) assert.equal(feature[field], undefined);
      }
    }
  }
});

test('every category / type pair is a known one, every unit belongs to its category', () => {
  for (const device of devices('en')) {
    for (const feature of device.features) {
      assert.ok(
        PAIRS.some(([category, type]) => feature.category === category && feature.type === type),
        `${feature.external_id}: ${feature.category} / ${feature.type}`,
      );
      if (NO_UNIT.includes(feature.type)) {
        assert.equal(feature.unit, undefined, feature.external_id);
      } else {
        assert.ok(UNITS_OF[feature.category].includes(feature.unit), feature.external_id);
      }
    }
  }
});

test('one device per room with a heater; the energy features only when the heaters report it', () => {
  assert.deepEqual(
    devices('en').map((d) => d.name),
    ['Living room', 'Bedroom'],
    'the Hall has no heater',
  );
  assert.deepEqual(keysOf(rooms[0]), [
    'target_temperature',
    'mode',
    'temperature',
    'operating_state',
    'power',
    'energy',
  ]);
  const [noEnergy] = parseContent(variant((c) => c.devices.forEach((d) => delete d.energyWh))).map(
    (room) => model(room),
  );
  assert.deepEqual(keysOf(noEnergy), ['target_temperature', 'mode', 'temperature']);
  for (const key of FEATURE_KEYS) assert.match(key, /^[a-z_]+$/);
});

test('the states: setpoint, heating on / off, temperature, heating now, power, index', () => {
  assert.deepEqual(statesOf(rooms[0]), {
    target_temperature: 21,
    mode: THERMOSTAT_MODE.HEATING,
    temperature: 19.8,
    operating_state: THERMOSTAT_OPERATING_STATE.HEATING,
    power: 1200,
    energy: 3.5,
  });
  const off = statesOf(rooms[1]);
  assert.equal(off.mode, THERMOSTAT_MODE.OFF);
  assert.equal(off.operating_state, THERMOSTAT_OPERATING_STATE.IDLE, 'off never heats');
  const idle = statesOf({ ...rooms[0], powerW: 0 });
  assert.equal(idle.operating_state, THERMOSTAT_OPERATING_STATE.IDLE);
  // Unknown values are not published.
  const unknown = statesOf({ ...rooms[0], powerW: null, energyKwh: null, temperature: null });
  assert.deepEqual(Object.keys(unknown), ['target_temperature', 'mode']);
});

test('the setpoint: 5 to 35 °C by whole degrees; the mode: off or heating', () => {
  const [setpoint, mode] = buildDevice(fakeGladys, rooms[0]).features;
  assert.deepEqual([setpoint.min, setpoint.max, setpoint.step], [5, 35, 1]);
  assert.deepEqual(
    mode.supported_options.map((o) => o.value),
    [THERMOSTAT_MODE.OFF, THERMOSTAT_MODE.HEATING],
  );
  for (const option of mode.supported_options) {
    assert.ok(option.value >= mode.min && option.value <= mode.max);
  }
});

test('external ids come from the Adax room id, never from the name', () => {
  const device = buildDevice(fakeGladys, rooms[0], 'fr');
  assert.equal(device.external_id, `ext:test-integration:room:${LIVING.id}`);
  const renamed = buildDevice(fakeGladys, { ...rooms[0], name: 'Salon' }, 'fr');
  assert.deepEqual(
    renamed.features.map((f) => f.external_id),
    device.features.map((f) => f.external_id),
  );
  assert.equal(renamed.name, 'Salon');
  assert.equal(device.features[0].name, 'Consigne');
  assert.equal(buildDevice(fakeGladys, { ...rooms[0], name: '' }).name, 'Adax 735362');
  assert.equal(buildDevice(fakeGladys, rooms[0], 'en', true).name, 'Living room (Home)');
  assert.deepEqual(device.params, [
    { name: 'ADAX_HOME', value: 'Home' },
    { name: 'ADAX_HEATERS', value: '2' },
  ]);
});

test('the whole Discovery batch and the states are accepted by the fake Gladys', async () => {
  for (const language of LANGUAGES) {
    const gladys = createFakeGladys();
    await gladys.connect();
    await gladys.publishDiscoveredDevices(
      rooms.filter(isPublishable).map((room) => buildDevice(gladys, room, language)),
    );
    assert.equal(gladys.fake.discoveredDevices.length, 2);
    await gladys.publishStates(rooms.flatMap((room) => buildStates(gladys, room)));
    assert.equal(gladys.fake.requests.filter((r) => r.status >= 400).length, 0);
    await gladys.disconnect();
  }
});
