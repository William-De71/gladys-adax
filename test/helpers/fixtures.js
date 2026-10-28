// -----------------------------------------------------------------------------
// Made-up Adax answers, shaped like the official OpenAPI document
// (https://api-1.adax.no/client-api/openapi: `{ homes, rooms, devices }`,
// temperatures in hundredths of a degree) and like the documented
// `?withEnergy=1` fields of the heaters (`energyWh`, `energyTime` in ms).
// Never a real account.
// -----------------------------------------------------------------------------

import { createAdaxApi } from '../../src/adax-api.js';

const T0 = Date.parse('2026-10-27T07:10:00Z');

// One home, three rooms: two heaters in the living room, one in the bedroom
// (heating off), a room without heater (not offered).
const CONTENT = {
  homes: [{ id: 501, name: 'Home' }],
  rooms: [
    {
      id: 735362,
      homeId: 501,
      name: 'Living room',
      heatingEnabled: true,
      targetTemperature: 2100,
      temperature: 1980,
    },
    {
      id: 750269,
      homeId: 501,
      name: 'Bedroom',
      heatingEnabled: false,
      targetTemperature: 1700,
      temperature: 1850,
    },
    { id: 760000, homeId: 501, name: 'Hall', heatingEnabled: null },
  ],
  devices: [
    {
      id: 9001,
      homeId: 501,
      roomId: 735362,
      name: 'Window',
      type: 'Heater',
      energyWh: 120,
      energyTime: T0,
    },
    {
      id: 9002,
      homeId: 501,
      roomId: 735362,
      name: 'Wall',
      type: 'Heater',
      energyWh: 80,
      energyTime: T0,
    },
    {
      id: 9003,
      homeId: 501,
      roomId: 750269,
      name: 'Bedroom heater',
      type: 'Heater',
      energyWh: 0,
      energyTime: T0,
    },
  ],
};

const LIVING = CONTENT.rooms[0];
const BEDROOM = CONTENT.rooms[1];

/**
 * @description A deep copy of the content, changed by a function.
 * @param {Function} [change] - `(copy) => void`.
 * @returns {object} The copy.
 */
function variant(change = () => {}) {
  const copy = JSON.parse(JSON.stringify(CONTENT));
  change(copy);
  return copy;
}

/**
 * @description A fake Adax API (no network): the content it serves, the
 * control requests it receives, an error to throw once.
 * @param {object} [content] - The content.
 * @returns {object} The fake API, with `calls`, `controls`, `content`, `failNext`, `statuses`.
 */
function fakeApi(content = CONTENT) {
  const fake = {
    content: JSON.parse(JSON.stringify(content)),
    calls: [],
    controls: [],
    credentials: null,
    failNext: null,
    // Room id -> status other than OK.
    statuses: {},
    setCredentials(id, secret) {
      fake.credentials = id && secret ? { id, secret } : null;
    },
    hasCredentials: () => fake.credentials !== null,
    async getContent() {
      fake.calls.push('getContent');
      fake.throwIfAsked();
      return JSON.parse(JSON.stringify(fake.content));
    },
    async control(rooms) {
      fake.calls.push('control');
      fake.throwIfAsked();
      fake.controls.push(JSON.parse(JSON.stringify(rooms)));
      return new Map(rooms.map((room) => [String(room.id), fake.statuses[room.id] ?? 'OK']));
    },
    requestsLastHour: () => fake.calls.length,
    throwIfAsked() {
      if (fake.failNext) {
        const error = fake.failNext;
        fake.failNext = null;
        throw error;
      }
    },
  };
  return fake;
}

/**
 * @description A fake `fetch` answering from a handler.
 * @param {Function} handler - `(url, init, n) => { status, body }`.
 * @returns {Function & { requests: object[] }} The fetch.
 */
function fakeFetch(handler) {
  const requests = [];
  const impl = async (url, init = {}) => {
    requests.push({ url, ...init });
    const answer = await handler(url, init, requests.length);
    const text = answer.body === undefined ? '' : JSON.stringify(answer.body);
    return { status: answer.status ?? 200, text: async () => text };
  };
  impl.requests = requests;
  return impl;
}

/**
 * @description A real API client on a fake fetch and a fake clock.
 * @param {Function} handler - The fetch handler.
 * @returns {{ api: object, fetch: Function, clock: object }} The client.
 */
function apiWithFetch(handler) {
  const clock = { now: 1_800_000_000_000, slept: [] };
  const fetchImpl = fakeFetch(handler);
  const api = createAdaxApi({
    fetchImpl,
    now: () => clock.now,
    sleep: async (ms) => {
      clock.slept.push(ms);
      clock.now += ms;
    },
  });
  return { api, fetch: fetchImpl, clock };
}

// Ids of the fake Gladys (selector "test-integration").
const fakeGladys = {
  externalIds: (type, id) => {
    const device = `ext:test-integration:${type}:${id}`;
    return { device, feature: (key) => `${device}:${key}` };
  },
};

export { T0, CONTENT, LIVING, BEDROOM, variant, fakeApi, fakeFetch, apiWithFetch, fakeGladys };
