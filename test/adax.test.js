// The Adax data model: parsing, temperatures, commands, energy accounting.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOUR_MS,
  decodeTemperature,
  encodeTarget,
  parseContent,
  heaterEnergy,
  roomEnergy,
  controlRoom,
} from '../src/adax.js';
import { CONTENT, T0, variant } from './helpers/fixtures.js';

test('the content becomes rooms with their home and heaters', () => {
  const rooms = parseContent(CONTENT);
  assert.deepEqual(
    rooms.map((room) => [room.id, room.name, room.homeName, room.heaters.length]),
    [
      ['735362', 'Living room', 'Home', 2],
      ['750269', 'Bedroom', 'Home', 1],
      ['760000', 'Hall', 'Home', 0],
    ],
  );
  const [living, bedroom, hall] = rooms;
  assert.deepEqual(
    [living.heatingEnabled, living.target, living.temperature, living.hasEnergy],
    [true, 21, 19.8, true],
  );
  assert.deepEqual([bedroom.heatingEnabled, bedroom.target], [false, 17]);
  assert.deepEqual(
    [hall.heatingEnabled, hall.target, hall.temperature, hall.hasEnergy],
    [null, null, null, false],
  );
});

test('missing or broken parts of the content are skipped', () => {
  assert.deepEqual(parseContent({}), []);
  assert.deepEqual(parseContent(null), []);
  const rooms = parseContent(
    variant((c) => {
      c.rooms.push({ name: 'no id' });
      c.devices.push({ roomId: 735362 });
      c.devices[0].energyWh = 'n/a';
      delete c.homes;
    }),
  );
  assert.equal(rooms.length, 3);
  assert.equal(rooms[0].heaters.length, 2);
  assert.equal(rooms[0].heaters.find((h) => h.id === '9001').energyWh, null);
  assert.equal(rooms[0].homeName, '');
});

test('temperatures: hundredths of a degree, setpoints by whole degrees within 5-35 °C', () => {
  assert.equal(decodeTemperature(2150), 21.5);
  assert.equal(decodeTemperature(1987), 19.9);
  assert.equal(decodeTemperature(null), null);
  assert.equal(encodeTarget(21), 2100);
  assert.equal(encodeTarget('19.6'), 2000);
  assert.equal(encodeTarget(5), 500);
  assert.throws(() => encodeTarget(4), RangeError);
  assert.throws(() => encodeTarget(36), RangeError);
  assert.throws(() => encodeTarget('warm'), RangeError);
});

test('a control: off alone, on with the setpoint (Adax ignores a setpoint while off)', () => {
  const [living, bedroom] = parseContent(CONTENT);
  assert.deepEqual(controlRoom(living, { heatingEnabled: false }), {
    id: 735362,
    heatingEnabled: false,
  });
  assert.deepEqual(controlRoom(bedroom, { heatingEnabled: true }), {
    id: 750269,
    heatingEnabled: true,
    targetTemperature: 1700,
  });
  assert.deepEqual(controlRoom(bedroom, { target: 22 }), {
    id: 750269,
    heatingEnabled: true,
    targetTemperature: 2200,
  });
  const hall = parseContent(CONTENT)[2];
  assert.equal(controlRoom(hall, { heatingEnabled: true }).targetTemperature, 2000, 'default');
});

test('energy of a heater: a baseline, the increase within an hour, the whole value after a reset', () => {
  const start = heaterEnergy(null, { energyWh: 120, energyTime: T0 }, T0);
  assert.deepEqual([start.deltaWh, start.powerW], [0, null]);
  // +2 min, +40 Wh: 1.2 kW.
  const next = heaterEnergy(start.record, { energyWh: 160, energyTime: T0 + 120000 }, T0);
  assert.deepEqual([next.deltaWh, next.powerW], [40, 1200]);
  // Same time again: nothing new.
  const same = heaterEnergy(next.record, { energyWh: 160, energyTime: T0 + 120000 }, T0);
  assert.deepEqual([same.deltaWh, same.record], [0, next.record]);
  // A new hour (08:00): the saw tooth started again, 30 Wh since 08:00.
  const hourStart = Math.ceil(T0 / HOUR_MS) * HOUR_MS;
  const after = heaterEnergy(next.record, { energyWh: 30, energyTime: hourStart + 90000 }, T0);
  assert.equal(after.deltaWh, 30);
  assert.equal(after.powerW, 1200);
  assert.equal(after.hour, hourStart / HOUR_MS);
  // A drop within the same hour is a reset too.
  const drop = heaterEnergy(next.record, { energyWh: 10, energyTime: T0 + 240000 }, T0);
  assert.equal(drop.deltaWh, 10);
});

test('energy: a glitch is ignored, no energy keeps the previous reading', () => {
  const start = heaterEnergy(null, { energyWh: 0, energyTime: T0 }, T0);
  const glitch = heaterEnergy(start.record, { energyWh: 90000, energyTime: T0 + 60000 }, T0);
  assert.equal(glitch.deltaWh, 0);
  const none = heaterEnergy(start.record, { energyWh: null, energyTime: T0 + 60000 }, T0);
  assert.deepEqual([none.deltaWh, none.record], [0, start.record]);
  // Without energyTime, the time of the reading is used.
  const noTime = heaterEnergy(start.record, { energyWh: 20, energyTime: null }, T0 + 60000);
  assert.equal(noTime.deltaWh, 20);
});

test('energy of a room: the sum of its heaters, per hour', () => {
  const [living] = parseContent(CONTENT);
  const first = roomEnergy({}, living, T0);
  assert.equal(first.deltaWh, 0);
  assert.deepEqual(Object.keys(first.heaters), ['9001', '9002']);
  const [later] = parseContent(
    variant((c) => {
      c.devices[0].energyWh = 150;
      c.devices[0].energyTime = T0 + 60000;
      c.devices[1].energyWh = 95;
      c.devices[1].energyTime = T0 + 60000;
    }),
  );
  const second = roomEnergy(first.heaters, later, T0 + 60000);
  assert.equal(second.deltaWh, 45);
  assert.equal(second.powerW, 2700);
  assert.deepEqual([...second.byHour], [[Math.floor(T0 / HOUR_MS), 45]]);
});
