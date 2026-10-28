// -----------------------------------------------------------------------------
// Configuration of the Adax integration.
//
// Fields of the config_schema:
//   - `account_id`         the account id shown in the Adax WiFi app
//                          (Account tab, "Remote user client API");
//   - `credential`         the password of a credential created there, a
//                          secret: never logged;
//   - `refresh_minutes`    how often every room is read (select: 1, 2, 5 or
//                          10 minutes, 2 by default);
//   - `language`           language of the texts Gladys does not ask for in
//                          a language (feature names, messages of the
//                          configuration button): `auto` follows the last
//                          widget request, and guesses it from the timezone
//                          of Gladys until a widget is shown.
//
// Internal key, outside the config_schema (stored with setConfig):
//   - `last_language`  language of the last widget request.
// -----------------------------------------------------------------------------

import { isLanguage } from './i18n.js';

const REFRESH_MINUTES = { options: [1, 2, 5, 10], default: 2 };
const AUTO_LANGUAGE = 'auto';
const INTERNAL_KEYS = { language: 'last_language' };

/**
 * @description Normalize the raw config object from the host API.
 * @param {object} [rawConfig] - The raw config values.
 * @returns {{ accountId: string, credential: string, refreshMinutes: number,
 *   language: string }} The config.
 */
function normalizeConfig(rawConfig = {}) {
  const config = rawConfig ?? {};
  const text = (value) => (typeof value === 'string' ? value.trim() : '');
  const minutes = Number(config.refresh_minutes);
  return {
    // The form may send the account id as a number.
    accountId:
      typeof config.account_id === 'number' ? String(config.account_id) : text(config.account_id),
    credential: text(config.credential),
    refreshMinutes: REFRESH_MINUTES.options.includes(minutes) ? minutes : REFRESH_MINUTES.default,
    language: isLanguage(config.language) ? config.language : AUTO_LANGUAGE,
  };
}

// Timezones of the countries speaking one of the languages of the
// integration; any other one is English. A guess for the first devices only:
// the first widget shown gives the real language.
const TIMEZONE_LANGUAGES = {
  fr: [
    'Europe/Paris',
    'Europe/Monaco',
    'Europe/Brussels',
    'Europe/Luxembourg',
    'Indian/Reunion',
    'Indian/Mayotte',
    'America/Guadeloupe',
    'America/Martinique',
    'America/Cayenne',
    'America/Miquelon',
    'Pacific/Noumea',
    'Pacific/Tahiti',
    'America/Montreal',
    'Africa/Abidjan',
    'Africa/Dakar',
    'Africa/Casablanca',
    'Africa/Algiers',
    'Africa/Tunis',
  ],
  de: ['Europe/Berlin', 'Europe/Busingen', 'Europe/Vienna', 'Europe/Zurich', 'Europe/Vaduz'],
  es: [
    'Europe/Madrid',
    'Atlantic/Canary',
    'Africa/Ceuta',
    'America/Mexico_City',
    'America/Bogota',
    'America/Lima',
    'America/Santiago',
    'America/Caracas',
    'America/Montevideo',
    'America/Asuncion',
    'America/La_Paz',
    'America/Guayaquil',
    'America/Havana',
    'America/Panama',
    'America/Costa_Rica',
    'America/Guatemala',
    'America/Santo_Domingo',
    'America/Puerto_Rico',
  ],
};

/**
 * @description The language guessed from a timezone, before any widget.
 * @param {string} timezone - IANA timezone of Gladys.
 * @returns {string} en, fr, de or es.
 * @example
 * guessLanguage('Europe/Paris'); // -> 'fr'
 */
function guessLanguage(timezone) {
  const zone = String(timezone ?? '');
  if (zone.startsWith('America/Argentina/')) return 'es';
  const found = Object.entries(TIMEZONE_LANGUAGES).find(([, zones]) => zones.includes(zone));
  return found ? found[0] : 'en';
}

/**
 * @description The stored language of the last widget request.
 * @param {object} [rawConfig] - The raw config values.
 * @param {string|null} fallback - The language when nothing valid is stored.
 * @returns {string|null} The language.
 */
function readLanguage(rawConfig, fallback) {
  const language = (rawConfig ?? {})[INTERNAL_KEYS.language];
  return isLanguage(language) ? language : fallback;
}

/**
 * @description The timezone of Gladys (TZ, set by the supervisor).
 * @returns {string} IANA timezone.
 */
function resolveTimezone() {
  return process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export {
  REFRESH_MINUTES,
  AUTO_LANGUAGE,
  INTERNAL_KEYS,
  normalizeConfig,
  guessLanguage,
  readLanguage,
  resolveTimezone,
};
