// -----------------------------------------------------------------------------
// Texts of the integration, in English, French, German and Spanish (English
// fallback).
//
// The manifest carries its own labels; these are the texts the code writes at
// runtime: feature names, widget contents, toasts, messages of the
// Configuration screen. Vocabulary of the Gladys interface: appareil / Gerät /
// dispositivo, scène / Szene / escena, consigne / Solltemperatur / consigna,
// pièce / Raum / estancia.
// -----------------------------------------------------------------------------

const LANGUAGES = ['en', 'fr', 'de', 'es'];

const TEXTS = {
  // feature names (Discovery, device page)
  feature_target_temperature: {
    en: 'Setpoint',
    fr: 'Consigne',
    de: 'Solltemperatur',
    es: 'Consigna',
  },
  feature_mode: { en: 'Heating', fr: 'Chauffage', de: 'Heizung', es: 'Calefacción' },
  feature_temperature: {
    en: 'Room temperature',
    fr: 'Température ambiante',
    de: 'Raumtemperatur',
    es: 'Temperatura ambiente',
  },
  feature_operating_state: { en: 'Heats', fr: 'Chauffe', de: 'Heizt', es: 'Calentando' },
  feature_power: { en: 'Power', fr: 'Puissance', de: 'Leistung', es: 'Potencia' },
  feature_energy: { en: 'Energy', fr: 'Énergie', de: 'Energie', es: 'Energía' },

  // widget: rooms
  badgeOff: { en: 'Off', fr: 'Arrêt', de: 'Aus', es: 'Apagado' },
  badgeWaiting: { en: 'Sending…', fr: 'Envoi…', de: 'Wird gesendet', es: 'Enviando…' },
  badgeHeatingPower: {
    en: 'Heats {power}',
    fr: 'Chauffe {power}',
    de: 'Heizt {power}',
    es: 'Calienta {power}',
  },
  detailHome: { en: 'Home', fr: 'Maison', de: 'Zuhause', es: 'Casa' },
  detailHeating: { en: 'Heating', fr: 'Chauffage', de: 'Heizung', es: 'Calefacción' },
  detailTemperature: {
    en: 'Room temperature',
    fr: 'Température ambiante',
    de: 'Raumtemperatur',
    es: 'Temperatura ambiente',
  },
  detailSetpoint: { en: 'Setpoint', fr: 'Consigne', de: 'Solltemperatur', es: 'Consigna' },
  detailPower: {
    en: 'Average power since the last reading',
    fr: 'Puissance moyenne depuis le dernier relevé',
    de: 'Mittlere Leistung seit der letzten Abfrage',
    es: 'Potencia media desde la última lectura',
  },
  detailIndex: {
    en: 'Energy index',
    fr: 'Index d’énergie',
    de: 'Energiezähler',
    es: 'Índice de energía',
  },
  detailHeaters: { en: 'Heaters', fr: 'Radiateurs', de: 'Heizgeräte', es: 'Radiadores' },
  heatingOn: { en: 'on', fr: 'allumé', de: 'an', es: 'encendida' },
  heatingOff: { en: 'off', fr: 'éteint', de: 'aus', es: 'apagada' },
  captionUpdated: {
    en: 'Read {ago}',
    fr: 'Relevé {ago}',
    de: 'Gelesen {ago}',
    es: 'Leído {ago}',
  },
  captionUpdatedHidden: {
    en: 'Read {ago} · {n} more: choose the rooms',
    fr: 'Relevé {ago} · {n} de plus : choisissez les pièces',
    de: 'Gelesen {ago} · {n} weitere: Räume wählen',
    es: 'Leído {ago} · {n} más: elija las estancias',
  },
  emptyRooms: {
    en: 'No room in this Adax account. Add your heaters to rooms in the Adax WiFi app.',
    fr: 'Aucune pièce sur ce compte Adax. Rangez vos radiateurs dans des pièces dans l’application Adax WiFi.',
    de: 'Kein Raum in diesem Adax-Konto. Ordnen Sie Ihre Heizgeräte in der Adax-WiFi-App Räumen zu.',
    es: 'Ninguna estancia en esta cuenta Adax. Asigne sus radiadores a estancias en la app Adax WiFi.',
  },
  buttonAllOn: { en: 'All on', fr: 'Tout allumer', de: 'Alle an', es: 'Encender todo' },
  buttonAllOff: { en: 'All off', fr: 'Tout éteindre', de: 'Alle aus', es: 'Apagar todo' },
  buttonRefresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },

  // widget: energy
  tileToday: { en: 'Today', fr: 'Aujourd’hui', de: 'Heute', es: 'Hoy' },
  tileYesterday: { en: 'Yesterday', fr: 'Hier', de: 'Gestern', es: 'Ayer' },
  tilePower: { en: 'Power', fr: 'Puissance', de: 'Leistung', es: 'Potencia' },
  chartTitle: {
    en: 'Last 24 hours',
    fr: 'Dernières 24 heures',
    de: 'Letzte 24 Stunden',
    es: 'Últimas 24 horas',
  },
  chartSeries: { en: 'Energy', fr: 'Énergie', de: 'Energie', es: 'Energía' },
  energyCaption: {
    en: '{n} room(s), counted by Gladys since the integration started',
    fr: '{n} pièce(s), comptées par Gladys depuis le démarrage',
    de: '{n} Raum/Räume, von Gladys seit dem Start gezählt',
    es: '{n} estancia(s), contadas por Gladys desde el inicio',
  },
  emptyEnergy: {
    en: 'No heater of these rooms reports its energy.',
    fr: 'Aucun radiateur de ces pièces ne remonte son énergie.',
    de: 'Kein Heizgerät dieser Räume meldet seine Energie.',
    es: 'Ningún radiador de estas estancias informa de su energía.',
  },

  // widget: status
  tileHeating: {
    en: 'Rooms heating',
    fr: 'Pièces chauffées',
    de: 'Räume beheizt',
    es: 'Calefacción',
  },
  tileRequests: {
    en: 'Requests (1 h)',
    fr: 'Requêtes (1 h)',
    de: 'Anfragen (1 h)',
    es: 'Peticiones (1 h)',
  },
  rowConnection: { en: 'Adax API', fr: 'API Adax', de: 'Adax-API', es: 'API Adax' },
  rowLastReading: {
    en: 'Last reading',
    fr: 'Dernier relevé',
    de: 'Letzte Abfrage',
    es: 'Última lectura',
  },
  rowInterval: { en: 'Reading', fr: 'Relevé', de: 'Abfrage', es: 'Lectura' },
  rowPaused: {
    en: 'Slowed down, next try',
    fr: 'Ralenti, prochain essai',
    de: 'Gedrosselt, nächster Versuch',
    es: 'Ralentizado, próximo intento',
  },
  everyMinutes: {
    en: 'every {n} min',
    fr: 'toutes les {n} min',
    de: 'alle {n} Min.',
    es: 'cada {n} min',
  },
  inMinutes: { en: 'in {n} min', fr: 'dans {n} min', de: 'in {n} Min.', es: 'en {n} min' },
  connection_ok: { en: 'Connected', fr: 'Connectée', de: 'Verbunden', es: 'Conectada' },
  connection_unknown: { en: 'Starting', fr: 'Démarrage', de: 'Startet', es: 'Iniciando' },
  connection_unconfigured: {
    en: 'Not configured',
    fr: 'Non configurée',
    de: 'Nicht eingerichtet',
    es: 'Sin configurar',
  },
  connection_refused: {
    en: 'Credentials refused',
    fr: 'Identifiants refusés',
    de: 'Zugangsdaten abgelehnt',
    es: 'Credenciales rechazadas',
  },
  connection_rate_limited: {
    en: 'Too many requests',
    fr: 'Trop de requêtes',
    de: 'Zu viele Anfragen',
    es: 'Demasiadas peticiones',
  },
  connection_error: {
    en: 'Unreachable',
    fr: 'Injoignable',
    de: 'Nicht erreichbar',
    es: 'Inaccesible',
  },
  connection_ok_hint: {
    en: 'Connected to the Adax API.',
    fr: 'Connectée à l’API Adax.',
    de: 'Mit der Adax-API verbunden.',
    es: 'Conectada a la API Adax.',
  },
  connection_unknown_hint: {
    en: 'Waiting for the first reading of Adax.',
    fr: 'En attente du premier relevé Adax.',
    de: 'Warten auf die erste Abfrage von Adax.',
    es: 'Esperando la primera lectura de Adax.',
  },
  connection_unconfigured_hint: {
    en: 'Enter the account id and a credential of the Adax WiFi app (Account → Remote user client API) in the configuration of the integration.',
    fr: 'Saisissez l’identifiant de compte et un identifiant d’accès de l’application Adax WiFi (Compte → Remote user client API) dans la configuration de l’intégration.',
    de: 'Geben Sie die Konto-ID und einen Zugang aus der Adax-WiFi-App (Konto → Remote user client API) in der Konfiguration der Integration ein.',
    es: 'Introduzca el id de cuenta y una credencial de la app Adax WiFi (Cuenta → Remote user client API) en la configuración de la integración.',
  },
  connection_refused_hint: {
    en: 'Adax refuses the account id or the credential. Check the account id, and create a new credential in the Adax WiFi app if needed.',
    fr: 'Adax refuse l’identifiant de compte ou l’identifiant d’accès. Vérifiez l’identifiant de compte et, au besoin, créez un nouvel accès dans l’application Adax WiFi.',
    de: 'Adax lehnt die Konto-ID oder den Zugang ab. Prüfen Sie die Konto-ID und legen Sie bei Bedarf in der Adax-WiFi-App einen neuen Zugang an.',
    es: 'Adax rechaza el id de cuenta o la credencial. Compruebe el id de cuenta y, si hace falta, cree una credencial nueva en la app Adax WiFi.',
  },
  connection_rate_limited_hint: {
    en: 'Adax asks to slow down: the integration waits longer between two readings, then goes back to normal by itself.',
    fr: 'Adax demande de ralentir : l’intégration espace ses relevés, puis revient d’elle-même au rythme normal.',
    de: 'Adax bittet um weniger Anfragen: Die Integration fragt seltener ab und kehrt dann von selbst zum normalen Takt zurück.',
    es: 'Adax pide reducir el ritmo: la integración espacia sus lecturas y vuelve sola al ritmo normal.',
  },
  connection_error_hint: {
    en: 'The Adax API does not answer. Check the Internet connection of Gladys; the integration tries again at every reading.',
    fr: 'L’API Adax ne répond pas. Vérifiez la connexion Internet de Gladys ; l’intégration réessaie à chaque relevé.',
    de: 'Die Adax-API antwortet nicht. Prüfen Sie die Internetverbindung von Gladys; die Integration versucht es bei jeder Abfrage erneut.',
    es: 'La API Adax no responde. Compruebe la conexión a Internet de Gladys; la integración lo reintenta en cada lectura.',
  },

  // relative times
  never: { en: 'never', fr: 'jamais', de: 'nie', es: 'nunca' },
  justNow: { en: 'just now', fr: 'à l’instant', de: 'gerade eben', es: 'ahora mismo' },
  minutesAgo: { en: '{n} min ago', fr: 'il y a {n} min', de: 'vor {n} Min.', es: 'hace {n} min' },
  hoursAgo: { en: '{n} h ago', fr: 'il y a {n} h', de: 'vor {n} Std.', es: 'hace {n} h' },
  daysAgo: { en: '{n} days ago', fr: 'il y a {n} jours', de: 'vor {n} Tagen', es: 'hace {n} días' },

  // Configuration screen (setConnectionStatus)
  statusUnconfigured: {
    en: 'Enter the account id and a credential created in the Adax WiFi app (Account → Remote user client API).',
    fr: 'Saisissez l’identifiant de compte et un identifiant d’accès créé dans l’application Adax WiFi (Compte → Remote user client API).',
    de: 'Geben Sie die Konto-ID und einen in der Adax-WiFi-App angelegten Zugang ein (Konto → Remote user client API).',
    es: 'Introduzca el id de cuenta y una credencial creada en la app Adax WiFi (Cuenta → Remote user client API).',
  },
  statusRefused: {
    en: 'Adax refuses the credentials ({reason}): check the account id and the password of the credential.',
    fr: 'Adax refuse les identifiants ({reason}) : vérifiez l’identifiant de compte et le mot de passe de l’accès.',
    de: 'Adax lehnt die Zugangsdaten ab ({reason}): Konto-ID und Passwort des Zugangs prüfen.',
    es: 'Adax rechaza las credenciales ({reason}): compruebe el id de cuenta y la contraseña de la credencial.',
  },
  statusRateLimited: {
    en: 'Adax asks to slow down: next reading in {n} min.',
    fr: 'Adax demande de ralentir : prochain relevé dans {n} min.',
    de: 'Adax bittet um weniger Anfragen: nächste Abfrage in {n} Min.',
    es: 'Adax pide reducir el ritmo: próxima lectura en {n} min.',
  },
  statusError: {
    en: 'The Adax API does not answer ({error}); next try at the next reading.',
    fr: 'L’API Adax ne répond pas ({error}) ; nouvel essai au prochain relevé.',
    de: 'Die Adax-API antwortet nicht ({error}); neuer Versuch bei der nächsten Abfrage.',
    es: 'La API Adax no responde ({error}); nuevo intento en la próxima lectura.',
  },
  statusOk: {
    en: '{count} Adax room(s), {heating} heating, read every {minutes} min.',
    fr: '{count} pièce(s) Adax, {heating} en chauffe, relevé toutes les {minutes} min.',
    de: '{count} Adax-Raum/Räume, {heating} beheizt, Abfrage alle {minutes} Min.',
    es: '{count} estancia(s) Adax, {heating} con calefacción, lectura cada {minutes} min.',
  },
  statusNoRoom: {
    en: 'Connected, but Adax lists no room with a heater: add your heaters to rooms in the Adax WiFi app.',
    fr: 'Connectée, mais Adax ne liste aucune pièce avec un radiateur : rangez vos radiateurs dans des pièces dans l’application Adax WiFi.',
    de: 'Verbunden, aber Adax listet keinen Raum mit Heizgerät: Ordnen Sie Ihre Heizgeräte in der Adax-WiFi-App Räumen zu.',
    es: 'Conectada, pero Adax no lista ninguna estancia con radiador: asigne sus radiadores a estancias en la app Adax WiFi.',
  },

  // toasts and action results
  toastAllOn: {
    en: 'Heating turned on in {n} room(s).',
    fr: 'Chauffage allumé dans {n} pièce(s).',
    de: 'Heizung in {n} Raum/Räumen eingeschaltet.',
    es: 'Calefacción encendida en {n} estancia(s).',
  },
  toastAllOff: {
    en: 'Heating turned off in {n} room(s).',
    fr: 'Chauffage éteint dans {n} pièce(s).',
    de: 'Heizung in {n} Raum/Räumen ausgeschaltet.',
    es: 'Calefacción apagada en {n} estancia(s).',
  },
  toastPartial: {
    en: 'Done in {n} room(s), refused in {failed}.',
    fr: 'Fait dans {n} pièce(s), refusé dans {failed}.',
    de: 'In {n} Raum/Räumen erledigt, in {failed} abgelehnt.',
    es: 'Hecho en {n} estancia(s), rechazado en {failed}.',
  },
  toastNoRoom: {
    en: 'No Adax room to change.',
    fr: 'Aucune pièce Adax à changer.',
    de: 'Kein Adax-Raum zu ändern.',
    es: 'Ninguna estancia Adax que cambiar.',
  },
  toastRefreshed: {
    en: '{n} room(s) read.',
    fr: '{n} pièce(s) relevée(s).',
    de: '{n} Raum/Räume abgefragt.',
    es: '{n} estancia(s) leída(s).',
  },
  toastFailed: {
    en: 'Adax: {error}',
    fr: 'Adax : {error}',
    de: 'Adax: {error}',
    es: 'Adax: {error}',
  },

  // "Test the connection" button
  testOk: {
    en: 'Connected. {count} room(s): {list}',
    fr: 'Connexion réussie. {count} pièce(s) : {list}',
    de: 'Verbunden. {count} Raum/Räume: {list}',
    es: 'Conexión correcta. {count} estancia(s): {list}',
  },
  testRoom: {
    en: '{name} ({heaters} heater(s), heating {state}, {features} features)',
    fr: '{name} ({heaters} radiateur(s), chauffage {state}, {features} fonctionnalités)',
    de: '{name} ({heaters} Heizgerät(e), Heizung {state}, {features} Funktionen)',
    es: '{name} ({heaters} radiador(es), calefacción {state}, {features} funciones)',
  },
};

/**
 * @description Whether a value is one of the languages of the integration.
 * @param {unknown} language - The value.
 * @returns {boolean} A language.
 */
const isLanguage = (language) => LANGUAGES.includes(language);

/**
 * @description A text in a language (English fallback), with its
 * substitutions.
 * @param {string} key - The TEXTS key.
 * @param {string} language - The language.
 * @param {object} [values] - The substitutions.
 * @returns {string} The text.
 * @example
 * t('minutesAgo', 'fr', { n: 3 }); // -> 'il y a 3 min'
 */
function t(key, language, values = {}) {
  const entry = TEXTS[key];
  if (!entry) return key;
  const template = entry[language] ?? entry.en;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
}

/**
 * @description The text in every language, for a multi-language message.
 * @param {string|Function} key - The TEXTS key, or `(language) => string`.
 * @param {object} [values] - The substitutions.
 * @returns {{ en: string, fr: string, de: string, es: string }} The message.
 */
function all(key, values = {}) {
  return Object.fromEntries(
    LANGUAGES.map((language) => [
      language,
      typeof key === 'function' ? key(language) : t(key, language, values),
    ]),
  );
}

const locale = (language) => (isLanguage(language) ? language : 'en');

/**
 * @description A number written in a language ("20,5", "20.5").
 * @param {number} n - The number.
 * @param {string} language - The language.
 * @returns {string} The text.
 */
const formatNumber = (n, language) =>
  new Intl.NumberFormat(locale(language), { maximumFractionDigits: 1 }).format(n);

/**
 * @description How long ago an instant was: "just now", "12 min ago".
 * @param {number} at - The instant, in ms (0: never).
 * @param {number} now - Now, in ms.
 * @param {string} language - The language.
 * @returns {string} The text.
 */
function ago(at, now, language) {
  if (!at) return t('never', language);
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) return t('justNow', language);
  if (minutes < 60) return t('minutesAgo', language, { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return t('hoursAgo', language, { n: hours });
  return t('daysAgo', language, { n: Math.floor(hours / 24) });
}

export { LANGUAGES, TEXTS, isLanguage, t, all, formatNumber, ago };
