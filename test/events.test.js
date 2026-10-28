// Scene triggers: one per transition, never on the first reading, never for a
// change the integration asked for; event data within the limits of the core.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRIGGERS, snapshotOf, detectEvents, parseHeating } from '../src/events.js';

const ROOM = { heatingEnabled: true, target: 21, temperature: 19.8 };
const context = (expected = () => false) => ({
  device: 'ext:test-integration:room:735362',
  name: 'Living room',
  isExpected: expected,
});

test('the first reading sets the baseline only', () => {
  const { events, snapshot } = detectEvents(null, ROOM, context());
  assert.deepEqual(events, []);
  assert.deepEqual(snapshot, { heating: true, target: 21 });
});

test('heating turned off / on, setpoint changed: one event each, with the room', () => {
  const off = detectEvents(snapshotOf(ROOM), { ...ROOM, heatingEnabled: false }, context());
  assert.deepEqual(off.events, [
    {
      key: TRIGGERS.HEATING_TURNED_OFF,
      data: {
        device: 'ext:test-integration:room:735362',
        device_name: 'Living room',
        temperature: 19.8,
        target_temperature: 21,
      },
    },
  ]);
  const on = detectEvents(off.snapshot, ROOM, context());
  assert.deepEqual(
    on.events.map((e) => e.key),
    [TRIGGERS.HEATING_TURNED_ON],
  );
  const changed = detectEvents(snapshotOf(ROOM), { ...ROOM, target: 18 }, context());
  assert.deepEqual(changed.events, [
    {
      key: TRIGGERS.SETPOINT_CHANGED,
      data: {
        device: 'ext:test-integration:room:735362',
        device_name: 'Living room',
        temperature: 19.8,
        target_temperature: 18,
        previous_target: 21,
      },
    },
  ]);
  // No change, no event; an unknown value is no transition.
  assert.deepEqual(detectEvents(snapshotOf(ROOM), ROOM, context()).events, []);
  assert.deepEqual(
    detectEvents(snapshotOf(ROOM), { ...ROOM, heatingEnabled: null, target: null }, context())
      .events,
    [],
  );
});

test('a change the integration asked for never fires', () => {
  const asked = (value) => value.heating === false || value.target === 18;
  const result = detectEvents(
    snapshotOf(ROOM),
    { ...ROOM, heatingEnabled: false, target: 18 },
    context(asked),
  );
  assert.deepEqual(result.events, []);
});

test('event data: flat scalars, 30 keys at most', () => {
  const { events } = detectEvents(snapshotOf(ROOM), { ...ROOM, target: 18 }, context());
  for (const { data } of events) {
    assert.ok(Object.keys(data).length <= 30);
    for (const value of Object.values(data)) {
      assert.ok(value === null || ['string', 'number', 'boolean'].includes(typeof value));
    }
  }
});

test('the on / off field of the set_heating action', () => {
  assert.equal(parseHeating('on'), true);
  assert.equal(parseHeating(' OFF '), false);
  assert.equal(parseHeating(true), true);
  assert.equal(parseHeating(0), false);
  assert.throws(() => parseHeating('maybe'), RangeError);
  assert.throws(() => parseHeating(undefined), RangeError);
});
