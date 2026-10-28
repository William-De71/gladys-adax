// The HTTP client against a fake fetch: the password grant, the spacing of
// the requests, the token renewal, the errors, and never a secret in a log.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  API_URL,
  MIN_INTERVAL_MS,
  CredentialsError,
  RateLimitError,
  ApiError,
  NetworkError,
} from '../src/adax-api.js';
import { apiWithFetch, CONTENT } from './helpers/fixtures.js';

const TOKEN = { access_token: 'token-1', refresh_token: 'refresh', expires_in: 86400 };

/**
 * @description A handler: the token, then the given answers for the API.
 * @param {Array<object>} answers - The API answers, in order.
 * @returns {Function} The handler.
 */
function script(answers) {
  let i = 0;
  return (url) => {
    if (url.endsWith('/auth/token')) return { status: 200, body: TOKEN };
    return answers[Math.min(i++, answers.length - 1)];
  };
}

test('the password grant of the official API, then the content with the energy', async () => {
  const { api, fetch } = apiWithFetch(script([{ status: 200, body: CONTENT }]));
  api.setCredentials('123456', 's3cr3t pass');
  assert.equal(api.hasCredentials(), true);
  const content = await api.getContent();
  assert.equal(content.rooms.length, 3);
  const [token, read] = fetch.requests;
  assert.equal(token.url, `${API_URL}/auth/token`);
  assert.equal(token.method, 'POST');
  assert.equal(token.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(token.body)), {
    grant_type: 'password',
    username: '123456',
    password: 's3cr3t pass',
  });
  assert.equal(read.url, `${API_URL}/rest/v1/content/?withEnergy=1`);
  assert.equal(read.headers.Authorization, 'Bearer token-1');
});

test('requests are 30 s apart; the token is kept until it expires', async () => {
  const { api, fetch, clock } = apiWithFetch(script([{ status: 200, body: CONTENT }]));
  api.setCredentials('1', 'x');
  await api.getContent();
  await api.getContent();
  assert.deepEqual(clock.slept, [MIN_INTERVAL_MS]);
  assert.equal(fetch.requests.filter((r) => r.url.endsWith('/auth/token')).length, 1);
  assert.equal(api.requestsLastHour(), 3);
  clock.now += 24 * 60 * 60 * 1000;
  await api.getContent();
  assert.equal(fetch.requests.filter((r) => r.url.endsWith('/auth/token')).length, 2);
});

test('a control request: one POST for every room, the status of each', async () => {
  const { api, fetch } = apiWithFetch(
    script([{ status: 200, body: { rooms: [{ id: 2, status: 'InvalidParams' }] } }]),
  );
  api.setCredentials('1', 'x');
  const statuses = await api.control([
    { id: 1, heatingEnabled: false },
    { id: 2, heatingEnabled: true, targetTemperature: 2100 },
  ]);
  assert.deepEqual(
    [...statuses],
    [
      ['1', 'OK'],
      ['2', 'InvalidParams'],
    ],
  );
  const post = fetch.requests[1];
  assert.equal(post.url, `${API_URL}/rest/v1/control/`);
  assert.deepEqual(JSON.parse(post.body), {
    rooms: [
      { id: 1, heatingEnabled: false },
      { id: 2, heatingEnabled: true, targetTemperature: 2100 },
    ],
  });
});

test('refused credentials: invalid_grant, as the real API answers', async () => {
  const { api } = apiWithFetch(() => ({ status: 400, body: { error: 'invalid_grant' } }));
  api.setCredentials('1', 'wrong');
  await assert.rejects(api.getContent(), (err) => {
    assert.ok(err instanceof CredentialsError);
    assert.equal(err.reason, 'INVALID_GRANT');
    assert.doesNotMatch(err.message, /wrong/);
    return true;
  });
});

test('no credentials: nothing is sent', async () => {
  const { api, fetch } = apiWithFetch(() => ({ status: 200, body: TOKEN }));
  await assert.rejects(api.getContent(), (err) => err.reason === 'MISSING');
  assert.equal(fetch.requests.length, 0);
});

test('an expired token (401 / 403): one new token, then the credentials are refused', async () => {
  let tokens = 0;
  const { api, fetch } = apiWithFetch((url) => {
    if (url.endsWith('/auth/token')) {
      tokens += 1;
      return { status: 200, body: { ...TOKEN, access_token: `token-${tokens}` } };
    }
    return tokens === 1 ? { status: 403 } : { status: 200, body: CONTENT };
  });
  api.setCredentials('1', 'x');
  await api.getContent();
  assert.equal(fetch.requests.at(-1).headers.Authorization, 'Bearer token-2');

  const denied = apiWithFetch((url) =>
    url.endsWith('/auth/token') ? { status: 200, body: TOKEN } : { status: 401 },
  );
  denied.api.setCredentials('1', 'x');
  await assert.rejects(denied.api.getContent(), (err) => err.reason === 'UNAUTHORIZED');
});

test('402 "Request limit exceeded" and 429: a slow-down for the caller', async () => {
  for (const status of [402, 429]) {
    const { api } = apiWithFetch(script([{ status }]));
    api.setCredentials('1', 'x');
    await assert.rejects(api.getContent(), (err) => {
      assert.ok(err instanceof RateLimitError);
      assert.ok(err.retryAfterMs >= 60 * 1000);
      return true;
    });
  }
});

test('other errors: HTTP status, unreachable API', async () => {
  const { api } = apiWithFetch(script([{ status: 500 }]));
  api.setCredentials('1', 'x');
  await assert.rejects(api.getContent(), (err) => err instanceof ApiError && err.status === 500);

  const down = apiWithFetch(() => {
    throw Object.assign(new Error('getaddrinfo'), { cause: { code: 'ENOTFOUND' } });
  });
  down.api.setCredentials('1', 'x');
  await assert.rejects(down.api.getContent(), (err) => {
    assert.ok(err instanceof NetworkError);
    assert.match(err.message, /ENOTFOUND/);
    return true;
  });
});

test('new credentials drop the token', async () => {
  const { api, fetch } = apiWithFetch(script([{ status: 200, body: CONTENT }]));
  api.setCredentials('1', 'x');
  await api.getContent();
  api.setCredentials('1', 'x');
  await api.getContent();
  assert.equal(fetch.requests.filter((r) => r.url.endsWith('/auth/token')).length, 1);
  api.setCredentials('2', 'y');
  await api.getContent();
  assert.equal(fetch.requests.filter((r) => r.url.endsWith('/auth/token')).length, 2);
});
