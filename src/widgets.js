// -----------------------------------------------------------------------------
// Dashboard widgets, built from the last reading (no request to Adax).
//
//   - rooms:  every room (or the ones chosen in the widget settings) as a
//             list — measured temperature, setpoint, a badge (off, heating
//             with its power, command waiting), the details on tap — and the
//             buttons "All on" / "All off" for these rooms, and "Refresh";
//   - energy: the energy of today and yesterday, the power now, and a bar
//             chart of the last 24 hours, for the whole home or the chosen
//             rooms (from the index the integration cumulates);
//   - status: the connection to the Adax API, the rooms heating, the
//             requests of the last hour, and "Refresh".
//
// The content stays within the budget of the core (8 components, 1 focal,
// 2 texts, 1 status, 4 buttons) and every text exists in the four languages
// (test/widgets.test.js runs validateWidgetContent on them).
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { HOUR_MS, hourOf } from './adax.js';
import { t, ago, formatNumber } from './i18n.js';

const WIDGETS = { ROOMS: 'rooms', ENERGY: 'energy', STATUS: 'status' };
const WIDGET_ACTIONS = { ALL_ON: 'all_on', ALL_OFF: 'all_off', REFRESH: 'refresh' };
// A list card holds 8 rows at most.
const MAX_ITEMS = 8;
const TTL_SECONDS = 60;
const CHART_HOURS = 24;

const isFahrenheit = (units) => units === 'us' || units === 'imperial';

/**
 * @description A temperature in the unit of the user: "20.5 °C", "68.9 °F".
 * @param {number|null} celsius - The temperature.
 * @param {string} units - metric or us.
 * @param {string} language - The language.
 * @returns {string} The text ("—" when unknown).
 */
function formatTemperature(celsius, units, language) {
  if (celsius === null || celsius === undefined) return '—';
  if (isFahrenheit(units)) return `${formatNumber((celsius * 9) / 5 + 32, language)} °F`;
  return `${formatNumber(celsius, language)} °C`;
}

/**
 * @description A power: "1 250 W", "—".
 * @param {number|null} watts - The power.
 * @param {string} language - The language.
 * @returns {string} The text.
 */
function formatPower(watts, language) {
  if (watts === null || watts === undefined) return '—';
  return `${formatNumber(Math.round(watts), language)} W`;
}

/**
 * @description The day of an instant in a timezone ("2026-10-28").
 * @param {number} ms - The instant.
 * @param {string} timezone - IANA timezone.
 * @returns {string} The day.
 */
function dayOf(ms, timezone) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(ms);
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/**
 * @description The energy of today, of yesterday and of each of the last 24
 * hours, summed over rooms.
 * @param {object[]} hoursList - Per room, hour number -> Wh.
 * @param {number} now - Now (ms).
 * @param {string} timezone - IANA timezone (the days of the user).
 * @returns {{ todayKwh: number, yesterdayKwh: number, points: Array<{t: string, v: number}> }}
 *   The summary (kWh rounded to 0.01 / 0.001).
 */
function energySummary(hoursList, now, timezone) {
  const total = new Map();
  for (const hours of hoursList) {
    for (const [hour, wh] of Object.entries(hours ?? {})) {
      total.set(Number(hour), (total.get(Number(hour)) ?? 0) + Number(wh));
    }
  }
  const today = dayOf(now, timezone);
  const yesterday = dayOf(now - 24 * HOUR_MS, timezone);
  let todayWh = 0;
  let yesterdayWh = 0;
  for (const [hour, wh] of total) {
    const day = dayOf(hour * HOUR_MS, timezone);
    if (day === today) todayWh += wh;
    else if (day === yesterday) yesterdayWh += wh;
  }
  const current = hourOf(now);
  const points = [];
  for (let hour = current - CHART_HOURS + 1; hour <= current; hour += 1) {
    points.push({
      t: new Date(hour * HOUR_MS).toISOString(),
      v: Math.round(total.get(hour) ?? 0) / 1000,
    });
  }
  return {
    todayKwh: Math.round(todayWh / 10) / 100,
    yesterdayKwh: Math.round(yesterdayWh / 10) / 100,
    points,
  };
}

/**
 * @description The badge of a room: what it does now.
 * @param {object} model - A parsed room.
 * @param {boolean} waiting - A command is not confirmed yet.
 * @param {string} language - The language.
 * @returns {{text: string, color: string}|undefined} The badge.
 */
function badgeOf(model, waiting, language) {
  if (waiting) return { text: t('badgeWaiting', language), color: WIDGET_COLORS.WARNING };
  if (model.heatingEnabled === false) {
    return { text: t('badgeOff', language), color: WIDGET_COLORS.NEUTRAL };
  }
  if (model.powerW > 0) {
    return {
      text: t('badgeHeatingPower', language, { power: formatPower(model.powerW, language) }),
      color: WIDGET_COLORS.INFO,
    };
  }
  return undefined;
}

/**
 * @description The details of a room, shown when its row is tapped.
 * @param {object} model - A parsed room.
 * @param {object} options - Options.
 * @returns {string} One fact per line.
 */
function detailsOf(model, { units, language }) {
  const lines = [];
  // French typography: a (non-breaking) space before the colon.
  const separator = language === 'fr' ? ' : ' : ': ';
  const line = (key, value) => lines.push(`${t(key, language)}${separator}${value}`);
  if (model.homeName) line('detailHome', model.homeName);
  line('detailHeating', t(model.heatingEnabled === false ? 'heatingOff' : 'heatingOn', language));
  line('detailTemperature', formatTemperature(model.temperature, units, language));
  line('detailSetpoint', formatTemperature(model.target, units, language));
  if (model.hasEnergy) {
    line('detailPower', formatPower(model.powerW, language));
    if (model.energyKwh !== null) {
      line('detailIndex', `${formatNumber(model.energyKwh, language)} kWh`);
    }
  }
  if (model.heaters.length > 0) {
    line(
      'detailHeaters',
      model.heaters.map((heater) => heater.name || heater.id).join(', ') ||
        String(model.heaters.length),
    );
  }
  return lines.join('\n');
}

/**
 * @description The one-line summary of a room: "20.5 °C → 21 °C".
 * @param {object} model - A parsed room.
 * @param {string} units - metric or us.
 * @param {string} language - The language.
 * @returns {string} The summary.
 */
function summaryOf(model, units, language) {
  const measured = formatTemperature(model.temperature, units, language);
  if (model.heatingEnabled === false) return measured;
  return `${measured} → ${formatTemperature(model.target, units, language)}`;
}

/**
 * @description The rooms widget.
 * @param {object} options - Options.
 * @param {Array<{model: object, name: string, waiting: boolean}>} options.rooms - The rooms to show.
 * @param {number} options.hidden - Rooms left out (more than 8).
 * @param {string} options.connection - ok, unconfigured, refused, rate_limited, error, unknown.
 * @param {number} options.lastSuccessAt - Last successful reading (ms, 0: never).
 * @param {string} options.language - The language.
 * @param {string} [options.units] - metric or us.
 * @param {number} options.now - Now (ms).
 * @returns {object} The content.
 */
function buildRoomsWidget({
  rooms,
  hidden = 0,
  connection,
  lastSuccessAt,
  language,
  units = 'metric',
  now,
}) {
  const components = [];
  if (lastSuccessAt) {
    components.push({
      type: 'text',
      variant: 'caption',
      text:
        hidden > 0
          ? t('captionUpdatedHidden', language, {
              ago: ago(lastSuccessAt, now, language),
              n: hidden,
            })
          : t('captionUpdated', language, { ago: ago(lastSuccessAt, now, language) }),
    });
  }
  if (rooms.length > 0) {
    components.push({
      type: 'card-list',
      display: 'list',
      items: rooms.slice(0, MAX_ITEMS).map(({ model, name, waiting }) => {
        const badge = badgeOf(model, waiting, language);
        return {
          title: name.slice(0, 60),
          subtitle: summaryOf(model, units, language),
          ...(badge ? { badge } : {}),
          description: detailsOf(model, { units, language }),
        };
      }),
    });
    components.push(
      {
        type: 'button',
        label: t('buttonAllOn', language),
        icon: 'sun',
        style: 'primary',
        action: { key: WIDGET_ACTIONS.ALL_ON, confirm: true },
      },
      {
        type: 'button',
        label: t('buttonAllOff', language),
        icon: 'power',
        style: 'secondary',
        action: { key: WIDGET_ACTIONS.ALL_OFF, confirm: true },
      },
    );
  } else {
    const key = connection === 'ok' ? 'emptyRooms' : `connection_${connection}_hint`;
    components.push({ type: 'text', variant: 'body', text: t(key, language) });
  }
  components.push({
    type: 'button',
    label: t('buttonRefresh', language),
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: WIDGET_ACTIONS.REFRESH },
  });
  return { ttl_seconds: TTL_SECONDS, components };
}

/**
 * @description The energy widget.
 * @param {object} options - Options.
 * @param {object[]} options.hours - Per room, hour number -> Wh.
 * @param {number|null} options.powerW - The power of these rooms now (null: unknown).
 * @param {number} options.rooms - Rooms counted (those reporting energy).
 * @param {string} options.connection - The connection state.
 * @param {string} options.language - The language.
 * @param {string} options.timezone - IANA timezone.
 * @param {number} options.now - Now (ms).
 * @returns {object} The content.
 */
function buildEnergyWidget({ hours, powerW, rooms, connection, language, timezone, now }) {
  if (rooms === 0) {
    const key = connection === 'ok' ? 'emptyEnergy' : `connection_${connection}_hint`;
    return {
      ttl_seconds: TTL_SECONDS,
      components: [{ type: 'text', variant: 'body', text: t(key, language) }],
    };
  }
  const summary = energySummary(hours, now, timezone);
  return {
    ttl_seconds: TTL_SECONDS,
    components: [
      {
        type: 'value',
        value: summary.todayKwh,
        unit: 'kWh',
        label: t('tileToday', language),
        icon: 'zap',
        color: WIDGET_COLORS.PRIMARY,
      },
      {
        type: 'value',
        value: summary.yesterdayKwh,
        unit: 'kWh',
        label: t('tileYesterday', language),
        icon: 'calendar',
      },
      {
        type: 'value',
        value: powerW === null ? '—' : Math.round(powerW),
        ...(powerW === null ? {} : { unit: 'W' }),
        label: t('tilePower', language),
        icon: 'activity',
        color: powerW > 0 ? WIDGET_COLORS.INFO : WIDGET_COLORS.NEUTRAL,
      },
      {
        type: 'chart',
        chart_type: 'bar',
        title: t('chartTitle', language),
        unit: 'kWh',
        series: [{ name: t('chartSeries', language), points: summary.points }],
      },
      {
        type: 'text',
        variant: 'caption',
        text: t('energyCaption', language, { n: rooms }),
      },
    ],
  };
}

const CONNECTION_COLOR = {
  ok: WIDGET_COLORS.SUCCESS,
  unconfigured: WIDGET_COLORS.WARNING,
  refused: WIDGET_COLORS.DANGER,
  rate_limited: WIDGET_COLORS.WARNING,
  error: WIDGET_COLORS.DANGER,
  unknown: WIDGET_COLORS.NEUTRAL,
};

/**
 * @description The connection widget.
 * @param {object} options - Options.
 * @param {string} options.connection - ok, unconfigured, refused, rate_limited, error, unknown.
 * @param {number} options.heating - Rooms with the heating on.
 * @param {number} options.total - Rooms.
 * @param {number} options.requests - Requests of the last hour.
 * @param {number} options.lastSuccessAt - Last successful reading (ms, 0: never).
 * @param {number} options.refreshMinutes - The reading interval.
 * @param {number} options.pausedUntil - End of a slow-down (ms, 0: none).
 * @param {string} options.language - The language.
 * @param {number} options.now - Now (ms).
 * @returns {object} The content.
 */
function buildStatusWidget({
  connection,
  heating,
  total,
  requests,
  lastSuccessAt,
  refreshMinutes,
  pausedUntil = 0,
  language,
  now,
}) {
  const components = [
    {
      type: 'value',
      value: `${heating}/${total}`,
      label: t('tileHeating', language),
      icon: 'thermometer',
      color: heating > 0 ? WIDGET_COLORS.INFO : WIDGET_COLORS.NEUTRAL,
    },
    {
      type: 'value',
      value: requests,
      label: t('tileRequests', language),
      icon: 'activity',
    },
  ];
  const rows = [
    {
      label: t('rowConnection', language),
      value: t(`connection_${connection}`, language),
      color: CONNECTION_COLOR[connection] ?? WIDGET_COLORS.NEUTRAL,
    },
    {
      label: t('rowLastReading', language),
      value: ago(lastSuccessAt, now, language),
      color: WIDGET_COLORS.NEUTRAL,
    },
    {
      label: t('rowInterval', language),
      value: t('everyMinutes', language, { n: refreshMinutes }),
      color: WIDGET_COLORS.NEUTRAL,
    },
  ];
  if (pausedUntil > now) {
    rows.push({
      label: t('rowPaused', language),
      value: t('inMinutes', language, { n: Math.ceil((pausedUntil - now) / 60000) }),
      color: WIDGET_COLORS.WARNING,
    });
  }
  components.push({ type: 'status', items: rows });
  if (connection !== 'ok' && connection !== 'unknown') {
    components.push({
      type: 'text',
      variant: 'body',
      text: t(`connection_${connection}_hint`, language),
    });
  }
  components.push({
    type: 'button',
    label: t('buttonRefresh', language),
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: WIDGET_ACTIONS.REFRESH },
  });
  return { ttl_seconds: TTL_SECONDS, components };
}

export {
  WIDGETS,
  WIDGET_ACTIONS,
  MAX_ITEMS,
  CHART_HOURS,
  formatTemperature,
  formatPower,
  dayOf,
  energySummary,
  badgeOf,
  detailsOf,
  summaryOf,
  buildRoomsWidget,
  buildEnergyWidget,
  buildStatusWidget,
};
