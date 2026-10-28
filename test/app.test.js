// The whole integration against the fake Gladys of the SDK and a fake Adax
// API: readings, discovery, states, energy, commands through the outbox,
// scene triggers and actions, widgets, errors, persistence.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';

import { createApp, CONFIRM_DELAY_MS, PENDING_MS, REFUSED_RETRY_MS } from '../src/app.js';
import { CredentialsError, RateLimitError, NetworkError } from '../src/adax-api.js';
import { THERMOSTAT_MODE, THERMOSTAT_OPERATING_STATE } from '../src/constants.js';
import { T0, LIVING, BEDROOM, fakeApi, variant } from './helpers/fixtures.js';

const CONFIG = { account_id: '123456', credential: 'secret' };
const ext = (room) => `ext:test-integration:room:${room.id}`;
const feature = (room, key) => `${ext(room)}:${key}`;

/**
 * @description A connected integration on a fake clock.
 * @param {object} [options] - Options.
 * @returns {Promise<object>} The handles.
 */
async function start({
  config = CONFIG,
  api = fakeApi(),
  statePath = null,
  created = true,
  devices = [],
} = {}) {
  const clock = { now: T0 };
  // `devices`: already added by the user before this start (a restart).
  const gladys = createFakeGladys({ config: { ...config }, devices });
  const app = createApp(gladys, {
    api,
    now: () => clock.now,
    statePath,
    tickMs: 0,
    gatherMs: 0,
    timezone: 'Europe/Paris',
  });
  await gladys.connect();
  if (created && devices.length === 0) {
    for (const device of gladys.fake.discoveredDevices) await gladys.fake.deviceCreated(device);
  }
  const advance = async (ms) => {
    clock.now += ms;
    await app.tick();
  };
  const device = (room) => gladys.fake.devices.find((d) => d.external_id === ext(room));
  const featureOf = (room, key) =>
    device(room).features.find((f) => f.external_id === feature(room, key));
  const state = (room, key) => gladys.fake.lastState(feature(room, key));
  return { gladys, app, api, clock, advance, device, featureOf, state };
}

/**
 * @description The content after the heaters used some energy.
 * @param {number} ms - Time since T0.
 * @param {number[]} wh - energyWh of the three heaters.
 * @param {Function} [change] - Other changes.
 * @returns {object} The content.
 */
const later = (ms, wh, change = () => {}) =>
  variant((c) => {
    c.devices.forEach((d, i) => {
      d.energyWh = wh[i];
      d.energyTime = T0 + ms;
    });
    change(c);
  });

test('without credentials: nothing is requested, the configuration says what to do', async () => {
  const { gladys, api } = await start({ config: {} });
  assert.deepEqual(api.calls, []);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.fr, /identifiant de compte/);
  assert.deepEqual(gladys.fake.discoveredDevices, []);
});

test('one request reads every room, the rooms are offered, the states published', async () => {
  const { gladys, api, state } = await start({ created: false });
  assert.deepEqual(api.calls, ['getContent']);
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.name),
    ['Living room', 'Bedroom'],
  );
  assert.equal(gladys.fake.states.length, 0, 'no state before the user adds a room');
  assert.equal(
    gladys.fake.connectionStatus.message.en,
    '2 Adax room(s), 1 heating, read every 2 min.',
  );
  await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[0]);
  assert.equal(state(LIVING, 'target_temperature'), 21);
  assert.equal(state(LIVING, 'mode'), THERMOSTAT_MODE.HEATING);
  assert.equal(state(LIVING, 'temperature'), 19.8);
  assert.equal(state(LIVING, 'energy'), 0, 'the index starts at 0');
  assert.equal(state(LIVING, 'power'), undefined, 'no power before two readings');
  assert.equal(state(BEDROOM, 'mode'), undefined);
  assert.ok(gladys.fake.widgetRefreshes.length > 0);
});

test('the clock reads again at the interval; energy index, power, heating now', async () => {
  const { gladys, api, advance, state } = await start();
  await advance(60 * 1000);
  assert.equal(api.calls.length, 1, 'not before 2 minutes');
  // +2 min: +40 Wh and +20 Wh in the living room.
  api.content = later(2 * 60000, [160, 100, 0]);
  const before = gladys.fake.states.length;
  await advance(60 * 1000);
  assert.equal(api.calls.length, 2);
  assert.equal(state(LIVING, 'energy'), 0.06);
  assert.equal(state(LIVING, 'power'), 1800);
  assert.equal(state(LIVING, 'operating_state'), THERMOSTAT_OPERATING_STATE.HEATING);
  assert.equal(state(BEDROOM, 'operating_state'), THERMOSTAT_OPERATING_STATE.IDLE);
  const published = gladys.fake.states.slice(before).map((s) => s.device_feature_external_id);
  assert.ok(!published.includes(feature(LIVING, 'target_temperature')), 'only what changed');
  await gladys.fake.configUpdated({ ...CONFIG, refresh_minutes: '10' });
  const calls = api.calls.length;
  await advance(5 * 60 * 1000);
  assert.equal(api.calls.length, calls, '10 minutes now');
});

test('a setpoint: answered at once, sent with the heating on, kept until the cloud confirms', async () => {
  const { gladys, app, api, advance, device, featureOf, state } = await start();
  const ack = await gladys.fake.setValue(
    device(BEDROOM),
    featureOf(BEDROOM, 'target_temperature'),
    22,
  );
  assert.equal(ack.success, true);
  assert.equal(state(BEDROOM, 'target_temperature'), 22, 'shown at once');
  assert.equal(state(BEDROOM, 'mode'), THERMOSTAT_MODE.HEATING, 'a setpoint turns it on');
  await app.flush();
  assert.deepEqual(api.controls, [
    [{ id: Number(BEDROOM.id), heatingEnabled: true, targetTemperature: 2200 }],
  ]);
  // The cloud still answers the old values: the commanded ones are kept.
  await advance(CONFIRM_DELAY_MS);
  assert.equal(api.calls.at(-1), 'getContent', 'one reading confirms the command');
  assert.equal(state(BEDROOM, 'target_temperature'), 22);
  // The cloud never confirms: after 3 minutes it wins.
  await advance(PENDING_MS);
  assert.equal(state(BEDROOM, 'target_temperature'), 17);
  assert.equal(state(BEDROOM, 'mode'), THERMOSTAT_MODE.OFF);
});

test('heating off from the mode feature; a wrong value is refused before anything is sent', async () => {
  const { gladys, app, api, device, featureOf, state } = await start();
  await gladys.fake.setValue(device(LIVING), featureOf(LIVING, 'mode'), THERMOSTAT_MODE.OFF);
  await app.flush();
  assert.deepEqual(api.controls, [[{ id: Number(LIVING.id), heatingEnabled: false }]]);
  assert.equal(state(LIVING, 'mode'), THERMOSTAT_MODE.OFF);
  for (const [key, value] of [
    ['target_temperature', 40],
    ['mode', THERMOSTAT_MODE.AUTO],
    ['temperature', 20],
  ]) {
    const ack = await gladys.fake.setValue(device(LIVING), featureOf(LIVING, key), value);
    assert.equal(ack.success, false, key);
  }
  await app.flush();
  assert.equal(api.controls.length, 1);
});

test('a command refused by Adax or failing: the commanded value is dropped', async () => {
  const api = fakeApi();
  api.statuses[BEDROOM.id] = 'NoAccess';
  const { gladys, app, device, featureOf, state } = await start({ api });
  await gladys.fake.setValue(device(BEDROOM), featureOf(BEDROOM, 'target_temperature'), 23);
  await app.flush();
  assert.equal(state(BEDROOM, 'target_temperature'), 17);
  assert.equal(app.pending.size, 0);
  api.failNext = new NetworkError('ETIMEDOUT');
  await gladys.fake.setValue(device(LIVING), featureOf(LIVING, 'target_temperature'), 23);
  await assert.rejects(app.flush());
  assert.equal(state(LIVING, 'target_temperature'), 21);
});

test('scene triggers: a change made in the Adax app fires, a change made by Gladys does not', async () => {
  const { gladys, app, api, advance, device, featureOf } = await start();
  api.content = variant((c) => {
    c.rooms[0].heatingEnabled = false;
    c.rooms[1].targetTemperature = 1900;
  });
  await advance(2 * 60 * 1000);
  assert.deepEqual(
    gladys.fake.sceneEvents.map((e) => [e.key, e.data.device, e.data.previous_target]),
    [
      ['heating_turned_off', ext(LIVING), undefined],
      ['setpoint_changed', ext(BEDROOM), 17],
    ],
  );
  // Gladys turns the living room on: the reading that confirms it fires nothing.
  await gladys.fake.setValue(device(LIVING), featureOf(LIVING, 'mode'), THERMOSTAT_MODE.HEATING);
  await app.flush();
  api.content = variant((c) => (c.rooms[1].targetTemperature = 1900));
  await advance(CONFIRM_DELAY_MS);
  assert.equal(gladys.fake.sceneEvents.length, 2);
});

test('scene action set_temperature: every room in ONE control request', async () => {
  const { gladys, api } = await start();
  const ack = await gladys.fake.sceneAction('set_temperature', { temperature: 19.6 });
  assert.deepEqual(ack.data.outputs, { count: 2, failed: 0, temperature: 20 });
  assert.deepEqual(api.controls, [
    [
      { id: Number(LIVING.id), heatingEnabled: true, targetTemperature: 2000 },
      { id: Number(BEDROOM.id), heatingEnabled: true, targetTemperature: 2000 },
    ],
  ]);
  const refused = await gladys.fake.sceneAction('set_temperature', { temperature: 50 });
  assert.equal(refused.success, false);
  assert.equal(api.controls.length, 1);
});

test('scene action set_heating: one room, a refusal counted', async () => {
  const api = fakeApi();
  const { gladys } = await start({ api });
  const off = await gladys.fake.sceneAction('set_heating', { device: ext(LIVING), state: 'off' });
  assert.deepEqual(off.data.outputs, { count: 1, failed: 0 });
  assert.deepEqual(api.controls.at(-1), [{ id: Number(LIVING.id), heatingEnabled: false }]);
  api.statuses[BEDROOM.id] = 'InternalError';
  const on = await gladys.fake.sceneAction('set_heating', { state: 'on' });
  assert.deepEqual(on.data.outputs, { count: 1, failed: 1 });
  const unknown = await gladys.fake.sceneAction('set_heating', { device: 'ext:nope', state: 'on' });
  assert.equal(unknown.success, false);
});

test('scene action refresh, and the "Test the connection" button', async () => {
  const { gladys, api, advance } = await start();
  await advance(60 * 1000);
  const ack = await gladys.fake.sceneAction('refresh', {});
  assert.deepEqual(ack.data.outputs, { rooms: 2, heating: 1, energy_today: 0 });
  assert.equal(api.calls.length, 2);
  // Within 30 s: no new request.
  await gladys.fake.sceneAction('refresh', {});
  assert.equal(api.calls.length, 2);
  const { data } = await gladys.fake.action('test_connection', {});
  const { message } = data;
  assert.match(
    message.en,
    /^Connected\. 2 room\(s\): Living room \(2 heater\(s\), heating on, 6 features\)/,
  );
  assert.match(message.fr, /Connexion réussie/);
});

test('refused credentials: the status says so, retried after 30 min or a new credential', async () => {
  const api = fakeApi();
  api.failNext = new CredentialsError('INVALID_GRANT', 400);
  const { gladys, advance } = await start({ api, created: false });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /INVALID_GRANT/);
  await advance(5 * 60 * 1000);
  assert.equal(api.calls.length, 1);
  await advance(REFUSED_RETRY_MS);
  assert.equal(api.calls.length, 2);
  api.failNext = new CredentialsError('INVALID_GRANT', 400);
  await advance(REFUSED_RETRY_MS);
  await gladys.fake.configUpdated({ ...CONFIG, credential: 'new' });
  assert.equal(api.calls.length, 4);
  assert.equal(api.credentials.secret, 'new');
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('402 "Request limit exceeded": the readings slow down, then come back', async () => {
  const api = fakeApi();
  const { gladys, app, advance } = await start({ api });
  api.failNext = new RateLimitError(5 * 60 * 1000);
  await advance(2 * 60 * 1000);
  assert.equal(app.connection(), 'rate_limited');
  assert.match(gladys.fake.connectionStatus.message.en, /next reading in 5 min/);
  const calls = api.calls.length;
  await advance(3 * 60 * 1000);
  assert.equal(api.calls.length, calls);
  await advance(3 * 60 * 1000);
  assert.equal(app.connection(), 'ok');
});

test('an unreachable API: an error status, the next reading tries again', async () => {
  const api = fakeApi();
  api.failNext = new NetworkError('ENOTFOUND');
  const { gladys, app, advance } = await start({ api, created: false });
  assert.equal(app.connection(), 'error');
  assert.match(gladys.fake.connectionStatus.message.en, /ENOTFOUND/);
  await advance(2 * 60 * 1000);
  assert.equal(app.connection(), 'ok');
});

test('widgets: rooms, energy, status; "All off" sends one request', async () => {
  const { gladys, api } = await start();
  const { content } = (await gladys.fake.widgetGet('rooms', { settings: {}, language: 'fr' })).data;
  const list = content.components.find((c) => c.type === 'card-list');
  assert.deepEqual(
    list.items.map((i) => i.title),
    ['Bedroom', 'Living room'],
  );
  const chosen = (
    await gladys.fake.widgetGet('rooms', { settings: { devices: [ext(LIVING)] }, language: 'en' })
  ).data.content;
  assert.equal(chosen.components.find((c) => c.type === 'card-list').items.length, 1);
  const energy = (await gladys.fake.widgetGet('energy', { settings: {}, language: 'en' })).data
    .content;
  assert.ok(energy.components.some((c) => c.type === 'chart'));
  const status = (await gladys.fake.widgetGet('status', { settings: {}, language: 'de' })).data
    .content;
  assert.equal(status.components[0].value, '1/2');
  const toast = await gladys.fake.widgetAction('rooms', 'all_off', {}, { settings: {} });
  assert.equal(toast.data.message.en, 'Heating turned off in 2 room(s).');
  assert.deepEqual(
    api.controls.at(-1).map((room) => room.heatingEnabled),
    [false, false],
  );
  const unknown = await gladys.fake.widgetAction('rooms', 'explode', {}, { settings: {} });
  assert.equal(unknown.success, false);
});

test('several homes: the home is added to the room names', async () => {
  const api = fakeApi(
    variant((c) => {
      c.homes.push({ id: 502, name: 'Cabin' });
      c.rooms[1].homeId = 502;
    }),
  );
  const { gladys } = await start({ api, created: false });
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.name),
    ['Living room (Home)', 'Bedroom (Cabin)'],
  );
});

test('the state survives a restart: energy index, snapshots, file mode 0600', async () => {
  const statePath = join(mkdtempSync(join(tmpdir(), 'adax-')), 'state.json');
  const api = fakeApi();
  const first = await start({ api, statePath });
  api.content = later(2 * 60000, [200, 100, 0]);
  await first.advance(2 * 60 * 1000);
  assert.equal(first.state(LIVING, 'energy'), 0.1);
  await first.gladys.fake.shutdown('SIGTERM');
  assert.equal(statSync(statePath).mode & 0o777, 0o600);
  assert.doesNotMatch(readFileSync(statePath, 'utf8'), /secret/);

  // Restart: the heaters went on; the index goes on from 0.1 kWh.
  const devices = first.gladys.fake.devices;
  const again = fakeApi(
    later(4 * 60000, [260, 140, 0], (c) => (c.rooms[0].heatingEnabled = false)),
  );
  const second = await start({ api: again, statePath, devices });
  assert.equal(second.state(LIVING, 'energy'), 0.2);
  assert.deepEqual(
    second.gladys.fake.sceneEvents.map((e) => e.key),
    ['heating_turned_off'],
    'a change made while stopped fires once',
  );
});
