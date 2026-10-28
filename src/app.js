// -----------------------------------------------------------------------------
// The Adax integration: every handler, registered on a Gladys client.
//
//   - one request, `GET /rest/v1/content/?withEnergy=1`, reads every room of
//     the account at the chosen interval (1, 2, 5 or 10 minutes) on the
//     integration's own clock: the rooms are never polled by Gladys
//     (`should_poll: false`);
//   - one Gladys device per Adax room (device.js), only the changed states
//     are published (publishChangedStates, with a 30-minute heartbeat); the
//     energy of the heaters is cumulated into an index per room (adax.js);
//   - Adax answers 402 when it gets too many requests: every request goes
//     through one queue, 30 s apart (adax-api.js). A command (setpoint, on /
//     off, scene action, widget button) is therefore not sent right away: it
//     joins an outbox, every room waiting is sent in ONE control request at
//     the next free slot, and the dashboard shows the commanded value at once.
//     One reading follows to confirm it; meanwhile, and for 3 minutes at most,
//     the commanded value wins over what the cloud still returns;
//   - scene triggers on transitions (events.js), scene actions, three widgets
//     (widgets.js), one configuration button ("Test the connection").
//
// Transport: cloud (Adax API). index.js only creates the SDK client; the
// tests drive this module with the fake Gladys of the SDK and a fake API.
// -----------------------------------------------------------------------------

import { logger as sdkLogger } from '@gladysassistant/integration-sdk';
import {
  normalizeConfig,
  readLanguage,
  guessLanguage,
  resolveTimezone,
  INTERNAL_KEYS,
  AUTO_LANGUAGE,
} from './config.js';
import {
  parseContent,
  roomEnergy,
  controlRoom,
  encodeTarget,
  hourOf,
  DEFAULT_TARGET,
} from './adax.js';
import { createAdaxApi, CredentialsError, RateLimitError, ApiError } from './adax-api.js';
import {
  buildDevice,
  buildStates,
  isPublishable,
  featuresOf,
  idsOf,
  deviceName,
  discoverySignature,
} from './device.js';
import { THERMOSTAT_MODE } from './constants.js';
import { TRIGGERS, SCENE_ACTIONS, detectEvents, parseHeating } from './events.js';
import {
  WIDGETS,
  WIDGET_ACTIONS,
  MAX_ITEMS,
  buildRoomsWidget,
  buildEnergyWidget,
  buildStatusWidget,
  energySummary,
} from './widgets.js';
import { createState, DEFAULT_PATH } from './state.js';
import { t, all, isLanguage } from './i18n.js';

const ACTIONS = { TEST: 'test_connection' };
// The clock: the due readings and commands are checked this often.
const TICK_MS = 10 * 1000;
// A command waits this long for others to join the same control request.
const GATHER_MS = 1000;
// The reading that confirms a command comes this long after it.
const CONFIRM_DELAY_MS = 30 * 1000;
// The commanded values win over the cloud answers this long at most.
const PENDING_MS = 3 * 60 * 1000;
// A change the integration asked for never fires a trigger within this delay.
const EXPECTED_MS = 10 * 60 * 1000;
// A refresh button or action reads again only past this delay.
const MIN_MANUAL_GAP_MS = 30 * 1000;
// Refused credentials are tried again this often.
const REFUSED_RETRY_MS = 30 * 60 * 1000;
// Slow-down after a 402: the interval doubles each time, up to this.
const MAX_PAUSE_MS = 30 * 60 * 1000;
// requestWidgetRefresh: at most once every 10 s per widget.
const WIDGET_REFRESH_GAP_MS = 10 * 1000;
// publishChangedStates also re-sends an unchanged value this old.
const HEARTBEAT_MS = 30 * 60 * 1000;

/**
 * @description Register every handler of the integration on a Gladys client.
 * @param {object} gladys - A GladysIntegration (or the fake Gladys of the SDK).
 * @param {object} [options] - Options.
 * @param {object} [options.api] - An Adax API client (tests).
 * @param {Function} [options.now] - `() => ms` (tests).
 * @param {string|null} [options.statePath] - File of the state (null: memory).
 * @param {number} [options.tickMs] - Clock period, 0 for none (tests).
 * @param {number} [options.gatherMs] - Wait before sending a command (tests).
 * @param {string} [options.timezone] - IANA timezone (days, language guess).
 * @param {object} [options.logger] - Logger.
 * @returns {object} Handles for the tests.
 */
function createApp(
  gladys,
  {
    api = createAdaxApi(),
    now = () => Date.now(),
    statePath = DEFAULT_PATH,
    tickMs = TICK_MS,
    gatherMs = GATHER_MS,
    timezone = resolveTimezone(),
    logger = sdkLogger,
  } = {},
) {
  const state = createState({ path: statePath, logger });
  let config = normalizeConfig({});
  let language = null;
  // id -> parsed room as the cloud returned it, with powerW and energyKwh.
  // What Gladys sees is this with the commanded values on top (view()).
  let cloud = new Map();
  let homeCount = 0;
  let lastDiscovery = null;
  let connection = 'unknown';
  let connectionDetail = null;
  let lastSuccessAt = 0;
  let lastAttemptAt = 0;
  let nextPollAt = 0;
  let pausedUntil = 0;
  let backoff = 0;
  let lastStatus = null;
  let polling = null;
  let timer = null;
  let running = Promise.resolve();
  // id -> { heatingEnabled?, target? } — commands not sent yet.
  const outbox = new Map();
  let flushing = null;
  // id -> { heatingEnabled?, target?, until } — commanded values not confirmed yet.
  const pending = new Map();
  // id -> { heatingEnabled?, target?, until } — values the integration asked for.
  const expected = new Map();
  const widgetRefreshedAt = new Map();

  const textLanguage = () =>
    config.language !== AUTO_LANGUAGE ? config.language : (language ?? guessLanguage(timezone));
  const intervalMs = () => config.refreshMinutes * 60 * 1000;
  const models = () => [...cloud.values()].map(view);
  const room = (id) => (cloud.has(id) ? view(cloud.get(id)) : null);
  const publishable = () => models().filter(isPublishable);
  const withHome = () => homeCount > 1;
  const nameOf = (model) => deviceName(model, withHome());
  const createdIds = () => new Set((gladys.devices ?? []).map((device) => device.external_id));
  const externalIdOf = (id) => idsOf(gladys, id).device;
  const byExternalId = (externalId) =>
    models().find((model) => externalIdOf(model.id) === externalId) ?? null;

  // --- Publishing ---------------------------------------------------------------

  /** @description Offer every room on the Discovery screen. */
  async function publishDiscovery({ force = false } = {}) {
    if (!gladys.connected) return;
    const list = publishable();
    const signature = discoverySignature(gladys, list, textLanguage(), withHome());
    if (!force && signature === lastDiscovery) return;
    try {
      await gladys.publishDiscoveredDevices(
        list.map((model) => buildDevice(gladys, model, textLanguage(), withHome())),
      );
      lastDiscovery = signature;
    } catch (err) {
      logger.error('Unable to publish the discovered devices', err);
    }
  }

  /**
   * @description Publish the changed states of the rooms the user created.
   * @param {object[]} list - Parsed rooms.
   */
  async function publishStates(list) {
    if (!gladys.connected) return;
    const created = createdIds();
    const states = list
      .filter((model) => created.has(externalIdOf(model.id)))
      .flatMap((model) => buildStates(gladys, model));
    if (states.length === 0) return;
    try {
      await gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
    } catch (err) {
      logger.error('Unable to publish the states', err);
    }
  }

  /** @description Ask Gladys to fetch the widgets again (10 s apart at least). */
  function refreshWidgets() {
    if (!gladys.connected) return;
    Object.values(WIDGETS).forEach((key) => {
      const last = widgetRefreshedAt.get(key) ?? -Infinity;
      if (now() - last < WIDGET_REFRESH_GAP_MS) return;
      widgetRefreshedAt.set(key, now());
      try {
        gladys.requestWidgetRefresh(key);
      } catch (err) {
        logger.warn(`Unable to refresh the widget ${key}: ${err.message}`);
      }
    });
  }

  /**
   * @description The message of the current connection state.
   * @returns {{connected: boolean, message: object}|null} The status (null: unknown yet).
   */
  function statusMessage() {
    if (connection === 'unconfigured') {
      return { connected: false, message: all('statusUnconfigured') };
    }
    if (connection === 'refused') {
      return {
        connected: false,
        message: all('statusRefused', { reason: connectionDetail ?? 'INVALID_GRANT' }),
      };
    }
    if (connection === 'rate_limited') {
      return {
        connected: true,
        message: all('statusRateLimited', {
          n: Math.max(1, Math.ceil((pausedUntil - now()) / 60000)),
        }),
      };
    }
    if (connection === 'error') {
      return {
        connected: false,
        message: all('statusError', { error: connectionDetail ?? 'network' }),
      };
    }
    if (connection === 'ok' && publishable().length === 0) {
      return { connected: true, message: all('statusNoRoom') };
    }
    if (connection === 'ok') {
      const list = publishable();
      return {
        connected: true,
        message: all('statusOk', {
          count: list.length,
          heating: list.filter((model) => model.heatingEnabled).length,
          minutes: config.refreshMinutes,
        }),
      };
    }
    return null;
  }

  /** @description Show the state of the connection in the Configuration screen. */
  async function reportStatus() {
    const status = statusMessage();
    if (!status) return;
    const signature = JSON.stringify(status);
    if (!gladys.connected || signature === lastStatus) return;
    lastStatus = signature;
    try {
      await gladys.setConnectionStatus(status.connected, status.message);
    } catch (err) {
      lastStatus = null;
      logger.error('Unable to report the status', err);
    }
  }

  /**
   * @description Fire a scene event; a refusal is logged, never thrown.
   * @param {string} key - The trigger.
   * @param {object} data - Its data.
   */
  async function fire(key, data) {
    try {
      await gladys.publishSceneEvent(key, data);
    } catch (err) {
      logger.warn(`Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Readings -----------------------------------------------------------------

  /**
   * @description A room with the values commanded but not confirmed yet on
   * top of the cloud values (never changes `pending`).
   * @param {object} model - The room as the cloud returned it.
   * @returns {object} The room Gladys sees.
   */
  function view(model) {
    const entry = pending.get(model.id);
    if (!entry || now() >= entry.until) return model;
    const result = { ...model };
    for (const key of ['heatingEnabled', 'target']) {
      if (key in entry) result[key] = entry[key];
    }
    return result;
  }

  /**
   * @description Drop the commanded values a new reading confirms, and the
   * late ones: from then on the cloud is right.
   * @param {object} model - The room as the cloud returned it.
   */
  function confirmPending(model) {
    const entry = pending.get(model.id);
    if (!entry) return;
    if (now() >= entry.until) {
      pending.delete(model.id);
      return;
    }
    for (const key of ['heatingEnabled', 'target']) {
      if (key in entry && model[key] === entry[key]) delete entry[key];
    }
    if (!('heatingEnabled' in entry) && !('target' in entry)) pending.delete(model.id);
  }

  /**
   * @description Whether the integration asked for this value of a room.
   * @param {string} id - The room id.
   * @param {object} value - `{ heating }` or `{ target }`.
   * @returns {boolean} Asked for.
   */
  function isExpected(id, value) {
    const entry = expected.get(id);
    if (!entry) return false;
    if (now() >= entry.until) {
      expected.delete(id);
      return false;
    }
    if ('heating' in value) return entry.heatingEnabled === value.heating;
    return entry.target === value.target;
  }

  /**
   * @description Take a new content in: parse, account the energy, detect
   * the scene events, remember the snapshot.
   * @param {object} content - The answer of the API.
   * @returns {Promise<object[]>} The parsed rooms.
   */
  async function ingest(content) {
    const readAt = now();
    const parsed = parseContent(content);
    const events = [];
    const created = createdIds();
    const next = new Map();
    homeCount = Array.isArray(content?.homes) ? content.homes.length : 0;
    for (const room of parsed) {
      const previousModel = cloud.get(room.id);
      confirmPending(room);
      let powerW = previousModel?.powerW ?? null;
      let energyKwh = null;
      if (room.hasEnergy) {
        const record = state.energy(room.id) ?? { kwh: 0, heaters: {} };
        const energy = roomEnergy(record.heaters, room, readAt);
        energyKwh = Math.round((record.kwh + energy.deltaWh / 1000) * 100000) / 100000;
        state.setEnergy(room.id, { kwh: energyKwh, heaters: energy.heaters });
        if (energy.byHour.size > 0) state.addHours(room.id, energy.byHour, hourOf(readAt));
        if (energy.powerW !== null) powerW = energy.powerW;
      }
      const model = { ...room, powerW, energyKwh };
      next.set(room.id, model);
      const result = detectEvents(state.snapshot(room.id), model, {
        device: externalIdOf(room.id),
        name: deviceName(model, homeCount > 1),
        isExpected: (value) => isExpected(room.id, value),
      });
      state.setSnapshot(room.id, result.snapshot);
      if (created.has(externalIdOf(room.id))) events.push(...result.events);
    }
    cloud = next;
    // An empty answer never wipes the energy indexes.
    if (cloud.size > 0) state.keep([...cloud.keys()]);
    state.save();
    for (const event of events) await fire(event.key, event.data);
    return models();
  }

  /**
   * @description Read every room (one request).
   * @param {string} reason - timer, manual, scan, connected, confirm.
   * @returns {Promise<boolean>} The reading worked.
   */
  function poll(reason = 'timer') {
    if (polling) return polling;
    polling = (async () => {
      lastAttemptAt = now();
      nextPollAt = now() + intervalMs();
      if (!api.hasCredentials()) {
        connection = 'unconfigured';
        await reportStatus();
        refreshWidgets();
        return false;
      }
      try {
        const content = await api.getContent();
        connection = 'ok';
        connectionDetail = null;
        backoff = 0;
        pausedUntil = 0;
        lastSuccessAt = now();
        nextPollAt = now() + intervalMs();
        const parsed = await ingest(content);
        logger.debug?.(`Read ${parsed.length} room(s) (${reason})`);
        await publishDiscovery();
        await publishStates(parsed);
        return true;
      } catch (err) {
        handleError(err);
        return false;
      } finally {
        await reportStatus();
        refreshWidgets();
      }
    })().finally(() => {
      polling = null;
    });
    return polling;
  }

  /**
   * @description Record an API failure: refused credentials, slow-down or
   * unreachable API.
   * @param {Error} err - The error.
   */
  function handleError(err) {
    if (err instanceof CredentialsError) {
      connection = err.reason === 'MISSING' ? 'unconfigured' : 'refused';
      connectionDetail = err.reason;
      pausedUntil = now() + REFUSED_RETRY_MS;
      nextPollAt = pausedUntil;
      logger.warn(`Adax refused the credentials (${err.reason})`);
    } else if (err instanceof RateLimitError) {
      backoff += 1;
      const pause = Math.min(MAX_PAUSE_MS, Math.max(err.retryAfterMs, intervalMs() * 2 ** backoff));
      connection = 'rate_limited';
      pausedUntil = now() + pause;
      nextPollAt = pausedUntil;
      logger.warn(`Adax limits the requests: next reading in ${Math.round(pause / 60000)} min`);
    } else {
      connection = 'error';
      connectionDetail = err instanceof ApiError ? `HTTP ${err.status}` : err.message?.slice(0, 80);
      logger.warn(`Adax reading failed: ${err.message}`);
    }
  }

  /** @description The clock: the commands waiting, then the due reading. */
  async function tick() {
    if (!gladys.connected) return;
    if (outbox.size > 0 && !flushing && now() >= pausedUntil) await flush().catch(() => {});
    if (now() >= nextPollAt && now() >= pausedUntil) await poll('timer');
  }

  // --- Commands -----------------------------------------------------------------

  /**
   * @description Send the outbox: every room waiting goes in one control
   * request; a command queued meanwhile goes in the next one (30 s later, the
   * pace of the API queue), within the same flush.
   * @returns {Promise<Map<string, string>>} Room id -> status (OK, NoAccess…).
   */
  function flush() {
    if (flushing) return flushing;
    flushing = (async () => {
      const statuses = new Map();
      if (gatherMs > 0) await new Promise((resolve) => setTimeout(resolve, gatherMs));
      while (outbox.size > 0) {
        const changes = [...outbox.entries()];
        outbox.clear();
        const ids = changes.map(([id]) => id);
        const payload = changes
          .filter(([id]) => cloud.has(id))
          .map(([id, change]) => controlRoom(room(id), change));
        try {
          const answer = await api.control(payload);
          for (const [id, status] of answer) {
            statuses.set(id, status);
            if (status !== 'OK') {
              pending.delete(id);
              logger.warn(`Adax refused the command for room ${id}: ${status}`);
            }
          }
        } catch (err) {
          // The commanded values are dropped: the next reading shows the truth.
          for (const id of ids) pending.delete(id);
          for (const id of outbox.keys()) pending.delete(id);
          outbox.clear();
          if (err instanceof RateLimitError || err instanceof CredentialsError) handleError(err);
          await afterCommand(ids);
          throw err;
        }
        // One reading confirms the commands (the API queue spaces it).
        nextPollAt = Math.min(nextPollAt, now() + CONFIRM_DELAY_MS);
        await afterCommand(ids);
      }
      return statuses;
    })().finally(() => {
      flushing = null;
    });
    return flushing;
  }

  /**
   * @description Publish the rooms touched by a command.
   * @param {string[]} ids - Room ids.
   */
  async function afterCommand(ids) {
    await publishStates(ids.map(room).filter(Boolean));
    refreshWidgets();
  }

  /**
   * @description Put a command for a room in the outbox and show it at once
   * (synchronous: a wrong value throws before anything is queued).
   * @param {object} model - The parsed room.
   * @param {{ heatingEnabled?: boolean, target?: number }} change - The change.
   */
  function queue(model, change) {
    if (!api.hasCredentials()) throw new Error('Adax is not configured');
    const normalized = { ...change };
    if (normalized.target !== undefined) {
      // Checks the range, rounds to the step.
      normalized.target = encodeTarget(normalized.target) / 100;
      // Adax ignores a setpoint while the heating is off: a setpoint turns it on.
      if (normalized.heatingEnabled === undefined) normalized.heatingEnabled = true;
    }
    if (normalized.heatingEnabled === true && normalized.target === undefined) {
      normalized.target = model.target ?? DEFAULT_TARGET;
    }
    outbox.set(model.id, { ...(outbox.get(model.id) ?? {}), ...normalized });
    pending.set(model.id, {
      ...(pending.get(model.id) ?? {}),
      ...normalized,
      until: now() + PENDING_MS,
    });
    expected.set(model.id, {
      ...(expected.get(model.id) ?? {}),
      ...normalized,
      until: now() + EXPECTED_MS,
    });
  }

  /**
   * @description The same change on several rooms, sent in one request.
   * @param {object[]} list - Parsed rooms.
   * @param {object} change - The change.
   * @returns {Promise<{count: number, failed: number}>} The outcome.
   */
  async function commandMany(list, change) {
    if (list.length === 0) return { count: 0, failed: 0 };
    for (const model of list) queue(model, change);
    await afterCommand(list.map((model) => model.id));
    const statuses = await flush();
    const count = list.filter((model) => statuses.get(model.id) === 'OK').length;
    return { count, failed: list.length - count };
  }

  /**
   * @description A room chosen in a scene action or a widget.
   * @param {string} externalId - The Gladys external id.
   * @returns {object} The parsed room.
   */
  function requireRoom(externalId) {
    const model = byExternalId(externalId);
    if (!model) throw new Error('Unknown Adax room: read the rooms again');
    return model;
  }

  /**
   * @description The rooms of a scene action: the one chosen, or all.
   * @param {string} [externalId] - The Gladys external id (empty: all).
   * @returns {object[]} The rooms.
   */
  function roomsOf(externalId) {
    return externalId ? [requireRoom(externalId)] : publishable();
  }

  gladys.onSetValue(async (device, deviceFeature, value) => {
    const model = requireRoom(device.external_id);
    const key = String(deviceFeature.external_id).slice(device.external_id.length + 1);
    let change;
    switch (key) {
      case 'target_temperature':
        change = { target: Number(value) };
        break;
      case 'mode': {
        const mode = Number(value);
        if (mode !== THERMOSTAT_MODE.OFF && mode !== THERMOSTAT_MODE.HEATING) {
          throw new Error(`Mode ${value} is not available on Adax`);
        }
        change = { heatingEnabled: mode === THERMOSTAT_MODE.HEATING };
        break;
      }
      default:
        throw new Error(`The feature ${key} is read-only`);
    }
    // The answer of Gladys is awaited 5 s: the command is queued and shown at
    // once, sent within 30 s (one request every 30 s at most).
    queue(model, change);
    await afterCommand([model.id]);
    flush().catch((err) => logger.warn(`Command for ${nameOf(model)} failed: ${err.message}`));
  });

  // --- Scene actions ----------------------------------------------------------------

  gladys.onSceneAction(SCENE_ACTIONS.SET_TEMPERATURE, async (fields = {}) => {
    const target = encodeTarget(fields.temperature) / 100;
    const { count, failed } = await commandMany(roomsOf(fields.device), { target });
    return { count, failed, temperature: target };
  });

  gladys.onSceneAction(SCENE_ACTIONS.SET_HEATING, async (fields = {}) => {
    const heatingEnabled = parseHeating(fields.state);
    return commandMany(roomsOf(fields.device), { heatingEnabled });
  });

  gladys.onSceneAction(SCENE_ACTIONS.REFRESH, async () => {
    if (now() - lastAttemptAt >= MIN_MANUAL_GAP_MS || !lastSuccessAt) {
      const ok = await poll('manual');
      if (!ok) throw new Error(`Adax reading failed (${connection})`);
    }
    const list = publishable();
    const summary = energySummary(
      list.map((model) => state.hours(model.id)),
      now(),
      timezone,
    );
    return {
      rooms: list.length,
      heating: list.filter((model) => model.heatingEnabled).length,
      energy_today: summary.todayKwh,
    };
  });

  // --- Configuration button ----------------------------------------------------------

  gladys.onAction(ACTIONS.TEST, async () => {
    if (!api.hasCredentials()) return all('statusUnconfigured');
    const ok = await poll('manual');
    if (!ok) return statusMessage()?.message ?? all('statusError', { error: 'network' });
    if (publishable().length === 0) return all('statusNoRoom');
    return all((lang) => {
      const list = publishable()
        .map((model) =>
          t('testRoom', lang, {
            name: nameOf(model),
            heaters: model.heaters.length,
            state: t(model.heatingEnabled ? 'heatingOn' : 'heatingOff', lang),
            features: featuresOf(model).length,
          }),
        )
        .join(' · ');
      return t('testOk', lang, { count: publishable().length, list }).slice(0, 2000);
    });
  });

  // --- Widgets ------------------------------------------------------------------------

  /**
   * @description Remember the language of the last widget request (the
   * feature names follow it when the configuration says "automatic").
   * @param {string} lang - The language of the request.
   */
  function rememberLanguage(lang) {
    if (!isLanguage(lang) || lang === language) return;
    const before = textLanguage();
    language = lang;
    gladys
      .setConfig({ [INTERNAL_KEYS.language]: lang })
      .catch((err) => logger.warn(`Unable to store the language: ${err.message}`));
    if (textLanguage() !== before) publishDiscovery();
  }

  /**
   * @description The rooms chosen in the settings of a widget (all when empty).
   * @param {object} settings - The widget settings.
   * @returns {object[]} The rooms, sorted by name.
   */
  function chosenRooms(settings = {}) {
    const wanted = Array.isArray(settings.devices) ? settings.devices : [];
    const list = publishable().sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    return wanted.length > 0
      ? list.filter((model) => wanted.includes(externalIdOf(model.id)))
      : list;
  }

  gladys.onWidgetGet(WIDGETS.ROOMS, async ({ settings = {}, language: lang, units } = {}) => {
    rememberLanguage(lang);
    const list = chosenRooms(settings);
    return buildRoomsWidget({
      rooms: list.slice(0, MAX_ITEMS).map((model) => ({
        model,
        name: nameOf(model),
        waiting: outbox.has(model.id) || pending.has(model.id),
      })),
      hidden: Math.max(0, list.length - MAX_ITEMS),
      connection,
      lastSuccessAt,
      language: isLanguage(lang) ? lang : textLanguage(),
      units,
      now: now(),
    });
  });

  gladys.onWidgetGet(WIDGETS.ENERGY, async ({ settings = {}, language: lang } = {}) => {
    rememberLanguage(lang);
    const list = chosenRooms(settings).filter((model) => model.hasEnergy);
    return buildEnergyWidget({
      hours: list.map((model) => state.hours(model.id)),
      powerW: list.reduce(
        (sum, model) => (model.powerW === null ? sum : (sum ?? 0) + model.powerW),
        null,
      ),
      rooms: list.length,
      connection,
      language: isLanguage(lang) ? lang : textLanguage(),
      timezone,
      now: now(),
    });
  });

  gladys.onWidgetGet(WIDGETS.STATUS, async ({ language: lang } = {}) => {
    rememberLanguage(lang);
    const list = publishable();
    return buildStatusWidget({
      connection,
      heating: list.filter((model) => model.heatingEnabled).length,
      total: list.length,
      requests: api.requestsLastHour(),
      lastSuccessAt,
      refreshMinutes: config.refreshMinutes,
      pausedUntil,
      language: isLanguage(lang) ? lang : textLanguage(),
      now: now(),
    });
  });

  /**
   * @description The buttons of the widgets.
   * @param {string} actionKey - The button.
   * @param {object} [_params] - Its params (none).
   * @param {object} [context] - `{ settings }` of the widget.
   * @returns {Promise<object>} The toast.
   */
  async function widgetAction(actionKey, _params = {}, { settings } = {}) {
    if (actionKey === WIDGET_ACTIONS.ALL_ON || actionKey === WIDGET_ACTIONS.ALL_OFF) {
      const heatingEnabled = actionKey === WIDGET_ACTIONS.ALL_ON;
      const list = chosenRooms(settings);
      if (list.length === 0) return all('toastNoRoom');
      const { count, failed } = await commandMany(list, { heatingEnabled });
      return all((lang) =>
        t(failed ? 'toastPartial' : heatingEnabled ? 'toastAllOn' : 'toastAllOff', lang, {
          n: count,
          failed,
        }),
      );
    }
    if (actionKey === WIDGET_ACTIONS.REFRESH) {
      if (now() - lastAttemptAt >= MIN_MANUAL_GAP_MS || !lastSuccessAt) {
        const ok = await poll('manual');
        if (!ok) {
          return all((lang) =>
            t('toastFailed', lang, { error: t(`connection_${connection}`, lang) }),
          );
        }
      }
      return all('toastRefreshed', { n: publishable().length });
    }
    throw new Error(`Unknown button ${actionKey}`);
  }
  gladys.onWidgetAction(WIDGETS.ROOMS, widgetAction);
  gladys.onWidgetAction(WIDGETS.ENERGY, widgetAction);
  gladys.onWidgetAction(WIDGETS.STATUS, widgetAction);

  // --- Devices and configuration --------------------------------------------------

  gladys.onScanRequest(async () => {
    await poll('scan');
    await publishDiscovery({ force: true });
  });

  gladys.onDeviceCreated(async (device) => {
    const model = byExternalId(device.external_id);
    if (model) await publishStates([model]);
    refreshWidgets();
  });

  gladys.onDeviceUpdated(async (device) => {
    const model = byExternalId(device.external_id);
    if (model) await publishStates([model]);
  });

  gladys.onConfigUpdated(async (raw) => {
    const previous = { ...config, language: textLanguage() };
    config = normalizeConfig(raw);
    language = readLanguage(raw, language);
    api.setCredentials(config.accountId, config.credential);
    const credentialsChanged =
      config.accountId !== previous.accountId || config.credential !== previous.credential;
    if (credentialsChanged) {
      connection = 'unknown';
      connectionDetail = null;
      pausedUntil = 0;
      backoff = 0;
      lastStatus = null;
    }
    if (textLanguage() !== previous.language) await publishDiscovery();
    if (credentialsChanged || config.refreshMinutes !== previous.refreshMinutes) {
      nextPollAt = 0;
      await tick();
    } else {
      refreshWidgets();
    }
  });

  gladys.on('connected', async () => {
    const raw = gladys.config ?? {};
    config = normalizeConfig(raw);
    language = readLanguage(raw, language);
    api.setCredentials(config.accountId, config.credential);
    lastStatus = null;
    lastDiscovery = null;
    nextPollAt = 0;
    running = poll('connected');
    await running;
    if (tickMs > 0 && timer === null) {
      timer = setInterval(() => {
        running = tick().catch((err) => logger.error('Tick failed', err));
      }, tickMs);
      timer.unref?.();
    }
  });

  const stop = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  gladys.handleShutdown(async (signal) => {
    logger.info(`Received ${signal} -> graceful shutdown`);
    stop();
    await running;
    state.save();
  });

  return {
    poll,
    tick,
    flush,
    stop,
    state,
    rooms: () => models(),
    connection: () => connection,
    outbox,
    pending,
  };
}

export {
  ACTIONS,
  TICK_MS,
  CONFIRM_DELAY_MS,
  PENDING_MS,
  MIN_MANUAL_GAP_MS,
  REFUSED_RETRY_MS,
  MAX_PAUSE_MS,
  TRIGGERS,
  createApp,
};
