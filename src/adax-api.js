// -----------------------------------------------------------------------------
// Client of the official Adax "Remote user client API"
// (https://adax.no/en/wi-fi/api-development/, OpenAPI at
// https://api-1.adax.no/client-api/openapi), with the account id and a
// credential the user creates in the Adax WiFi app (Account → Remote user
// client API → Add credential).
//
//   POST https://api-1.adax.no/client-api/auth/token     OAuth2 password grant
//   GET  .../rest/v1/content/?withEnergy=1               homes, rooms, heaters
//   POST .../rest/v1/control/                            { rooms: [{ id, … }] }
//
// - Adax answers 402 "Request limit exceeded": requests go one at a time,
//   spaced by 30 s at least (the pace of pyAdax, the library of Home
//   Assistant), and a 402 / 429 is reported as a RateLimitError for the
//   caller to slow down. The token request is not spaced: it is rare.
// - The access token is renewed 60 s before it expires, and once more when
//   the API answers 401 ("Invalid authorization") or 403 ("Authorization
//   expired").
// - The credential and the tokens are never logged nor put in an error message.
// -----------------------------------------------------------------------------

const API_URL = 'https://api-1.adax.no/client-api';
const TOKEN_PATH = '/auth/token';
const CONTENT_PATH = '/rest/v1/content/?withEnergy=1';
const CONTROL_PATH = '/rest/v1/control/';
// Two requests to the API are this far apart at least.
const MIN_INTERVAL_MS = 30 * 1000;
const TIMEOUT_MS = 20 * 1000;
// Renew the token this long before it expires.
const TOKEN_MARGIN_MS = 60 * 1000;
// Lifetime assumed when the answer gives none.
const DEFAULT_TOKEN_LIFETIME_S = 60 * 60;
// A 402 / 429 asks to wait this long before the next request.
const RATE_LIMIT_WAIT_MS = 5 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** The account id / credential pair is refused. */
class CredentialsError extends Error {
  /**
   * @param {string} reason - MISSING, INVALID_GRANT, UNAUTHORIZED…
   * @param {number|null} status - HTTP status.
   */
  constructor(reason, status = null) {
    super(`Adax refused the credentials (${reason})`);
    this.name = 'CredentialsError';
    this.reason = reason;
    this.status = status;
  }
}

/** Adax asks to slow down (402 "Request limit exceeded", or 429). */
class RateLimitError extends Error {
  /** @param {number} retryAfterMs - The wait before the next request. */
  constructor(retryAfterMs) {
    super('Adax limits the requests');
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

/** Any other HTTP error of the API. */
class ApiError extends Error {
  /**
   * @param {number} status - HTTP status.
   * @param {string} [detail] - A short detail, free of any secret.
   */
  constructor(status, detail = '') {
    super(`Adax API error ${status}${detail ? ` (${detail})` : ''}`);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** The API cannot be reached (DNS, timeout, connection refused). */
class NetworkError extends Error {
  /** @param {string} message - What failed (never a URL with a secret). */
  constructor(message) {
    super(`Adax API unreachable: ${message}`);
    this.name = 'NetworkError';
  }
}

/**
 * @description Create an Adax API client.
 * @param {object} [options] - Options.
 * @param {Function} [options.fetchImpl] - `fetch` (tests).
 * @param {Function} [options.now] - `() => ms` (tests).
 * @param {Function} [options.sleep] - `(ms) => Promise` (tests).
 * @param {number} [options.minIntervalMs] - Spacing of two API requests.
 * @param {number} [options.timeoutMs] - Timeout of a request.
 * @param {string} [options.userAgent] - User-Agent header.
 * @returns {object} The client.
 * @example
 * const api = createAdaxApi();
 * api.setCredentials('123456', 'credential');
 * const content = await api.getContent();
 */
function createAdaxApi({
  fetchImpl = (...args) => fetch(...args),
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  minIntervalMs = MIN_INTERVAL_MS,
  timeoutMs = TIMEOUT_MS,
  userAgent = 'gladys-adax',
} = {}) {
  let accountId = '';
  let credential = '';
  let token = null;
  let tokenRefreshAt = 0;
  let tokenRequest = null;
  // The queue of API requests: one at a time, spaced.
  let queue = Promise.resolve();
  let nextSlot = 0;
  const sentAt = [];

  /** @description Forget the requests older than an hour. */
  function prune() {
    const limit = now() - HOUR_MS;
    while (sentAt.length && sentAt[0] < limit) sentAt.shift();
  }

  /**
   * @description One HTTP exchange.
   * @param {string} url - The URL.
   * @param {object} init - The fetch options.
   * @returns {Promise<{status: number, body: object|null}>} The answer.
   */
  async function send(url, init) {
    sentAt.push(now());
    prune();
    let response;
    try {
      response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const reason = err?.name === 'TimeoutError' ? 'timeout' : (err?.cause?.code ?? 'network');
      throw new NetworkError(reason);
    }
    const text = await response.text().catch(() => '');
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    return { status: response.status, body };
  }

  /**
   * @description Run a task in the queue, 30 s after the previous one.
   * @param {Function} task - `() => Promise`.
   * @returns {Promise<unknown>} Its result.
   */
  function enqueue(task) {
    const run = async () => {
      const wait = nextSlot - now();
      if (wait > 0) await sleep(wait);
      try {
        return await task();
      } finally {
        nextSlot = now() + minIntervalMs;
      }
    };
    const result = queue.then(run, run);
    queue = result.catch(() => {});
    return result;
  }

  /** @description Request a new access token (password grant). */
  async function fetchToken() {
    if (!accountId || !credential) throw new CredentialsError('MISSING');
    const form = new URLSearchParams({
      grant_type: 'password',
      username: accountId,
      password: credential,
    });
    const answer = await send(`${API_URL}${TOKEN_PATH}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': userAgent,
      },
      body: form.toString(),
    });
    if (answer.status === 402 || answer.status === 429) {
      throw new RateLimitError(RATE_LIMIT_WAIT_MS);
    }
    if ([400, 401, 403].includes(answer.status)) {
      // `{"error": "invalid_grant"}` for an unknown account or a wrong credential.
      const reason = answer.body?.error === 'invalid_grant' ? 'INVALID_GRANT' : 'REFUSED';
      throw new CredentialsError(reason, answer.status);
    }
    if (answer.status >= 400) throw new ApiError(answer.status);
    const accessToken = answer.body?.access_token;
    if (typeof accessToken !== 'string' || !accessToken) {
      throw new ApiError(answer.status, 'no access token in the answer');
    }
    const expiresIn = Number(answer.body?.expires_in);
    const lifetime =
      Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : DEFAULT_TOKEN_LIFETIME_S;
    token = accessToken;
    tokenRefreshAt = now() + Math.max(0, lifetime * 1000 - TOKEN_MARGIN_MS);
    return token;
  }

  /** @description A valid access token (shared by concurrent callers). */
  async function accessToken() {
    if (token && now() < tokenRefreshAt) return token;
    if (!tokenRequest) {
      tokenRequest = fetchToken().finally(() => {
        tokenRequest = null;
      });
    }
    return tokenRequest;
  }

  /**
   * @description Call the REST API (in the queue).
   * @param {string} method - GET or POST.
   * @param {string} path - The path.
   * @param {object} [payload] - The JSON body.
   * @returns {Promise<object>} The parsed answer.
   */
  function call(method, path, payload) {
    return enqueue(async () => {
      for (let renewed = false; ; renewed = true) {
        const bearer = await accessToken();
        const answer = await send(`${API_URL}${path}`, {
          method,
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${bearer}`,
            'User-Agent': userAgent,
            ...(payload ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(payload ? { body: JSON.stringify(payload) } : {}),
        });
        if (answer.status === 402 || answer.status === 429) {
          throw new RateLimitError(RATE_LIMIT_WAIT_MS);
        }
        if (answer.status === 401 || answer.status === 403) {
          // An expired or revoked token: one new token, then give up.
          token = null;
          if (renewed) throw new CredentialsError('UNAUTHORIZED', answer.status);
          continue;
        }
        if (answer.status >= 400) throw new ApiError(answer.status);
        return answer.body ?? {};
      }
    });
  }

  return {
    /**
     * @description Use these credentials from now on (drops the token).
     * @param {string} id - The account id.
     * @param {string} secret - The credential (password) of the remote API.
     */
    setCredentials(id, secret) {
      const changed = id !== accountId || secret !== credential;
      accountId = id ?? '';
      credential = secret ?? '';
      if (changed) {
        token = null;
        tokenRefreshAt = 0;
      }
    },
    hasCredentials: () => Boolean(accountId && credential),
    /** @returns {Promise<{homes?: Array, rooms?: Array, devices?: Array}>} The content. */
    getContent: () => call('GET', CONTENT_PATH),
    /**
     * @description Send room changes in one request.
     * @param {Array<object>} rooms - `[{ id, heatingEnabled?, targetTemperature? }]`.
     * @returns {Promise<Map<string, string>>} Room id -> status (OK, NoAccess,
     *   InvalidParams, InternalError); a room absent from the answer is OK.
     */
    async control(rooms) {
      const body = await call('POST', CONTROL_PATH, { rooms });
      const statuses = new Map(rooms.map((room) => [String(room.id), 'OK']));
      for (const room of Array.isArray(body?.rooms) ? body.rooms : []) {
        if (room?.id !== undefined && typeof room.status === 'string') {
          statuses.set(String(room.id), room.status);
        }
      }
      return statuses;
    },
    /** @returns {number} Milliseconds before the next request can go. */
    waitBeforeNext: () => Math.max(0, nextSlot - now()),
    /** @returns {number} Requests sent during the last hour. */
    requestsLastHour() {
      prune();
      return sentAt.length;
    },
  };
}

export {
  API_URL,
  TOKEN_PATH,
  CONTENT_PATH,
  CONTROL_PATH,
  MIN_INTERVAL_MS,
  RATE_LIMIT_WAIT_MS,
  CredentialsError,
  RateLimitError,
  ApiError,
  NetworkError,
  createAdaxApi,
};
