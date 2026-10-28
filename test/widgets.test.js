import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import { parseContent, HOUR_MS } from '../src/adax.js';
import {
  buildRoomsWidget,
  buildEnergyWidget,
  buildStatusWidget,
  energySummary,
  formatTemperature,
  summaryOf,
  detailsOf,
  badgeOf,
  WIDGET_ACTIONS,
  MAX_ITEMS,
  CHART_HOURS,
} from '../src/widgets.js';
import { LANGUAGES } from '../src/i18n.js';
import { CONTENT } from './helpers/fixtures.js';

const NOW = Date.parse('2026-10-28T10:42:00Z');
const STATES = ['ok', 'unknown', 'unconfigured', 'refused', 'rate_limited', 'error'];
const [LIVING, BEDROOM] = parseContent(CONTENT).map((room) => ({
  ...room,
  powerW: room.heatingEnabled ? 1250 : 0,
  energyKwh: 12.34,
}));
const entry = (model, waiting = false) => ({ model, name: model.name, waiting });
const rooms = (overrides = {}) =>
  buildRoomsWidget({
    rooms: [entry(LIVING), entry(BEDROOM)],
    connection: 'ok',
    lastSuccessAt: NOW - 60000,
    language: 'en',
    now: NOW,
    ...overrides,
  });
// 30 hours of 400 Wh, by hour number.
const HOURS = Object.fromEntries(
  Array.from({ length: 30 }, (_, i) => [Math.floor(NOW / HOUR_MS) - i, 400]),
);
const energy = (overrides = {}) =>
  buildEnergyWidget({
    hours: [HOURS],
    powerW: 1250,
    rooms: 1,
    connection: 'ok',
    language: 'en',
    timezone: 'Europe/Paris',
    now: NOW,
    ...overrides,
  });
const status = (overrides = {}) =>
  buildStatusWidget({
    connection: 'ok',
    heating: 1,
    total: 2,
    requests: 31,
    lastSuccessAt: NOW - 30000,
    refreshMinutes: 2,
    language: 'en',
    now: NOW,
    ...overrides,
  });
const byType = (content, type) => content.components.filter((c) => c.type === type);

test('every content is rendered exactly as sent, in every language and state', () => {
  for (const language of LANGUAGES) {
    for (const units of ['metric', 'us']) {
      assert.deepEqual(validateWidgetContent(rooms({ language, units })), [], language);
    }
    const many = Array.from({ length: 8 }, (_, i) =>
      entry({ ...LIVING, id: `${i}`, name: `Room with a rather long name number ${i}` }, i === 2),
    );
    assert.deepEqual(validateWidgetContent(rooms({ language, rooms: many, hidden: 4 })), []);
    assert.deepEqual(validateWidgetContent(energy({ language })), [], language);
    assert.deepEqual(validateWidgetContent(energy({ language, powerW: null })), []);
    for (const connection of STATES) {
      assert.deepEqual(validateWidgetContent(rooms({ language, connection, rooms: [] })), []);
      assert.deepEqual(validateWidgetContent(energy({ language, connection, rooms: 0 })), []);
      assert.deepEqual(
        validateWidgetContent(status({ language, connection, pausedUntil: NOW + 120000 })),
        [],
        `${language} ${connection}`,
      );
    }
  }
});

test('rooms: a row per room, "All on" / "All off" asking first, Refresh', () => {
  const content = rooms();
  const [list] = byType(content, 'card-list');
  assert.deepEqual(
    list.items.map((item) => [item.title, item.subtitle, item.badge?.text]),
    [
      ['Living room', '19.8 °C → 21 °C', 'Heats 1,250 W'],
      ['Bedroom', '18.5 °C', 'Off'],
    ],
  );
  assert.deepEqual(
    byType(content, 'button').map((b) => [b.action.key, b.action.confirm ?? false]),
    [
      [WIDGET_ACTIONS.ALL_ON, true],
      [WIDGET_ACTIONS.ALL_OFF, true],
      [WIDGET_ACTIONS.REFRESH, false],
    ],
  );
  assert.equal(byType(content, 'text')[0].text, 'Read 1 min ago');
  // No room: the hint, no on / off button.
  const empty = rooms({ rooms: [], connection: 'refused', lastSuccessAt: 0 });
  assert.match(byType(empty, 'text')[0].text, /refuses/);
  assert.deepEqual(
    byType(empty, 'button').map((b) => b.action.key),
    [WIDGET_ACTIONS.REFRESH],
  );
  assert.equal(MAX_ITEMS, 8);
});

test('rooms: a command not confirmed yet, the details, the units', () => {
  assert.deepEqual(badgeOf(LIVING, true, 'fr'), { text: 'Envoi…', color: 'warning' });
  assert.equal(badgeOf({ ...LIVING, powerW: 0 }, false, 'en'), undefined);
  assert.equal(summaryOf(LIVING, 'us', 'en'), '67.6 °F → 69.8 °F');
  assert.equal(formatTemperature(null, 'metric', 'en'), '—');
  const details = detailsOf(LIVING, { units: 'metric', language: 'fr' }).split('\n');
  assert.deepEqual(details, [
    'Maison : Home',
    'Chauffage : allumé',
    'Température ambiante : 19,8 °C',
    'Consigne : 21 °C',
    'Puissance moyenne depuis le dernier relevé : 1 250 W',
    'Index d’énergie : 12,3 kWh',
    'Radiateurs : Window, Wall',
  ]);
});

test('energy: today and yesterday in the timezone of Gladys, the last 24 hours', () => {
  // 10:42 UTC = 11:42 in Paris: today holds 12 hours (00:00-11:59 Paris).
  const summary = energySummary([HOURS, { [Math.floor(NOW / HOUR_MS)]: 100 }], NOW, 'Europe/Paris');
  assert.equal(summary.todayKwh, 12 * 0.4 + 0.1);
  assert.equal(summary.yesterdayKwh, 18 * 0.4, 'the 30 hours reach 18 hours of yesterday');
  assert.equal(summary.points.length, CHART_HOURS);
  assert.equal(summary.points.at(-1).v, 0.5);
  assert.equal(
    summary.points.at(-1).t,
    new Date(Math.floor(NOW / HOUR_MS) * HOUR_MS).toISOString(),
  );
  const content = energy();
  assert.deepEqual(
    byType(content, 'value').map((v) => [v.label, v.value, v.unit]),
    [
      ['Today', 4.8, 'kWh'],
      ['Yesterday', 7.2, 'kWh'],
      ['Power', 1250, 'W'],
    ],
  );
  const [chart] = byType(content, 'chart');
  assert.equal(chart.chart_type, 'bar');
  assert.equal(chart.series[0].points.length, 24);
  assert.equal(byType(energy({ powerW: null }), 'value')[2].value, '—');
  assert.match(byType(energy({ rooms: 0 }), 'text')[0].text, /No heater/);
});

test('status: rooms heating, requests, connection, slow-down, Refresh', () => {
  const content = status({ connection: 'rate_limited', pausedUntil: NOW + 5 * 60000 });
  assert.deepEqual(
    byType(content, 'value').map((v) => v.value),
    ['1/2', 31],
  );
  const [rows] = byType(content, 'status');
  assert.deepEqual(
    rows.items.map((row) => row.value),
    ['Too many requests', 'just now', 'every 2 min', 'in 5 min'],
  );
  assert.match(byType(content, 'text')[0].text, /slow down/);
  assert.equal(byType(status(), 'text').length, 0);
});
