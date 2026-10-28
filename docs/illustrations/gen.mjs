// Builds the widget contents of the illustrations with the integration's own
// code: node gen.mjs <repo> <out.json> (run by render.sh)
//
// The three widgets on the made-up rooms of a home, on a fixed morning
// (Wednesday 28 October 2026, 8:42 in Oslo): five rooms (a living room
// heating, a kitchen at its setpoint, a bathroom with a command being sent, a
// bedroom off, an office), the energy of the last hours (more at night and in
// the morning), and the connection to the API.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [repo, out] = process.argv.slice(2);
const load = (path) => import(pathToFileURL(`${repo}/${path}`).href);
const { buildRoomsWidget, buildEnergyWidget, buildStatusWidget } = await load('src/widgets.js');
const { parseContent, HOUR_MS } = await load('src/adax.js');
const { LANGUAGES } = await load('src/i18n.js');
const manifest = JSON.parse(readFileSync(`${repo}/gladys-assistant-integration.json`, 'utf8'));

const NOW = Date.parse('2026-10-28T07:42:00Z');
const TIMEZONE = 'Europe/Oslo';
const room = (id, heatingEnabled, target, temperature) => ({
  id,
  homeId: 1,
  heatingEnabled,
  targetTemperature: target * 100,
  temperature: temperature * 100,
});
const CONTENT = {
  homes: [{ id: 1, name: 'Home' }],
  rooms: [
    room(1, true, 21, 19.6),
    room(2, true, 20, 20.1),
    room(3, true, 23, 21.4),
    room(4, false, 16, 17.2),
    room(5, true, 19, 18.8),
  ],
  devices: [1, 2, 3, 4, 5].map((id) => ({
    id: 100 + id,
    homeId: 1,
    roomId: id,
    name: `Neo ${id}`,
    type: 'Heater',
    energyWh: 100,
    energyTime: NOW,
  })),
};
const POWER = { 1: 1240, 2: 0, 3: 610, 4: 0, 5: 380 };
const NAMES = {
  en: ['Living room', 'Kitchen', 'Bathroom', 'Bedroom', 'Office'],
  fr: ['Salon', 'Cuisine', 'Salle de bains', 'Chambre', 'Bureau'],
  de: ['Wohnzimmer', 'Küche', 'Badezimmer', 'Schlafzimmer', 'Büro'],
  es: ['Salón', 'Cocina', 'Baño', 'Dormitorio', 'Despacho'],
};
const WAITING = new Set(['3']);

// 30 hours of energy for the whole home: a night setback, a morning peak.
const current = Math.floor(NOW / HOUR_MS);
const hours = {};
for (let i = 0; i < 30; i += 1) {
  const local = (new Date((current - i) * HOUR_MS).getUTCHours() + 1) % 24;
  const wh = local < 5 ? 900 : local < 9 ? 2600 : local < 17 ? 1300 : local < 22 ? 2100 : 1500;
  hours[current - i] = i === 0 ? Math.round((wh * 42) / 60) : wh + ((i * 137) % 300);
}

const contents = {};
for (const language of LANGUAGES) {
  const rooms = parseContent(CONTENT).map((parsed, i) => {
    const model = {
      ...parsed,
      name: NAMES[language][i],
      powerW: POWER[parsed.id],
      energyKwh: 812.4 + i * 97.3,
    };
    return { model, name: model.name, waiting: WAITING.has(parsed.id) };
  });
  contents[language] = {
    rooms: buildRoomsWidget({
      rooms,
      connection: 'ok',
      lastSuccessAt: NOW - 60 * 1000,
      language,
      units: 'metric',
      now: NOW,
    }),
    energy: buildEnergyWidget({
      hours: [hours],
      powerW: 2230,
      rooms: 5,
      connection: 'ok',
      language,
      timezone: TIMEZONE,
      now: NOW,
    }),
    status: buildStatusWidget({
      connection: 'ok',
      heating: 4,
      total: 5,
      requests: 32,
      lastSuccessAt: NOW - 60 * 1000,
      refreshMinutes: 2,
      language,
      now: NOW,
    }),
  };
}
const widgets = Object.fromEntries(
  manifest.widgets.map((w) => [w.key, { icon: w.icon, label: w.label }]),
);
writeFileSync(out, JSON.stringify({ now: NOW, widgets, contents }));
