# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for Adax WiFi panel heaters: a
Node.js service (Node 22+, ESM, no build step) that runs in its own sandboxed
Docker container and talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. The rooms come from the official **Adax remote
user client API** (https://adax.no/en/wi-fi/api-development/), with the account
id and a credential the user creates in the Adax WiFi app (OAuth2 password
grant). Transport: cloud.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
DEBUG=gladys-integration-sdk npm test     # with the SDK debug logs
npm run coverage                          # tests with the coverage of node --test
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store . --skip-image-check   # store checks
scripts/build-cover.sh                    # cover.jpg from docs/assets/cover.svg
docs/illustrations/render.sh              # docs/assets/widgets.<lang>.png
node .github/scripts/release.mjs next     # the version the next release would get
```

## Architecture

```
index.js                SDK wiring only (new GladysIntegration + createApp)
src/app.js              every handler, registered before connect(); the clock
                        (tick), the readings, the outbox of commands, the
                        commanded values shown until confirmed, the errors
                        (refused credentials, 402), the status
src/adax-api.js         the HTTP client: token (password grant, renewed 60 s
                        before it expires), one request every 30 s at most,
                        402 / 429 reported, error classes; never logs a secret
src/adax.js             the Adax data model: content -> parsed rooms, hundredths
                        of a degree, control encoding, energy accounting
src/device.js           one Gladys device per Adax room, its features and states
src/constants.js        Gladys core values the SDK does not export (thermostat
                        mode / operating state)
src/events.js           scene trigger detection (transitions) and action keys
src/widgets.js          rooms, energy and status dashboard widgets
src/state.js            /data/state.json: trigger snapshots, energy index per
                        room, energy of the last 48 hours
src/config.js           configuration (account id, credential, interval, language)
src/i18n.js             runtime texts, en / fr / de / es
gladys-assistant-integration.json   manifest
docs/{en,fr,de,es}.md   user documentation, re-hosted by the store
docs/illustrations/     generated widget images (render.sh, gen.mjs, render.js)
.github/scripts/release.mjs         version, changelog, bump (tested in test/)
```

## Rules

- **External ids are forever**, and so is every key users store: the device
  external id `ext:<selector>:room:<Adax room id>` (URI-encoded, never the
  name), the feature keys (`target_temperature`, `mode`, `temperature`,
  `operating_state`, `power`, `energy`), feature `category` / `type` / `unit`
  / `min` / `max` / `step`, the keys of `config_schema`, `actions`, the select
  values (`1`, `2`, `5`, `10`, `auto`…), the widgets and their settings, the
  widget button actions (`all_on`, `all_off`, `refresh`), the scene triggers
  (fields, variables) and scene actions (fields, options, outputs).
  `test/structure.test.js` compares them to
  `test/fixtures/discovery.baseline.json`: never update the baseline to make a
  test pass without a documented migration.
- **One device per ROOM**: the Adax API sets the setpoint and the heating of a
  room, never of a heater. A room is offered when it has a heater (or a
  setpoint).
- **Category / type pairs** come from the SDK constants and the core 5.3.0:
  `thermostat` / `target-temperature`, `mode` (OFF / HEATING only),
  `operating-state`; `temperature-sensor` / `decimal`; `energy-sensor` /
  `power` (watt) and `index` (kilowatt-hour, the one Gladys turns into a
  consumption and a cost).
- **Energy**: `energyWh` of a heater grows during the hour and restarts at 0
  every hour (home-assistant/core#150994). `src/adax.js` adds the increase
  within an hour, the whole value after a new hour or a drop, ignores more
  than 4 kWh in one reading, and the index per room lives in /data. Never
  publish the raw `energyWh` as an index.
- **`should_poll` stays false**: one `GET /rest/v1/content/?withEnergy=1`
  reads every room on the integration's own clock (1, 2, 5 or 10 minutes).
  Never add a request per room.
- **Adax refuses more than about one request every 30 s (402)**: every request
  goes through the queue of `adax-api.js`, 30 s apart. A command never waits
  in `onSetValue` (5 s ack): it joins the outbox, is shown at once, and every
  room waiting goes in ONE control request at the next free slot; one reading
  follows 30 s later. The commanded values win over the cloud for 3 minutes
  at most. A 402 slows the readings down (the interval doubles, up to
  30 minutes); refused credentials are tried again every 30 minutes or as soon
  as they change.
- **Writes**: whole degrees, 5 to 35 °C, sent in hundredths. Adax ignores a
  setpoint while the heating is off: a setpoint is always sent with
  `heatingEnabled: true`; "on" without a known setpoint uses 20 °C.
- **The credential** is a `secret`: never logged, never in /data, never in a
  scene variable nor an error message; neither is the access token.
- **Scene events**: one per transition between two readings of a room the
  user added (baseline at the first reading, kept in /data across restarts);
  never as the consequence of a command of the integration (10 minutes).
- **Gladys does not pass DEBUG / LOG_LEVEL to the container**: never tell a
  store user to set them; "Test the connection" is the diagnostic button.
- **The container rootfs is read-only.** Write only under `/data`.
- **Four languages.** Every user-facing text (manifest, runtime messages in
  `src/i18n.js`, `docs/*.md`, README) exists in English, French, German and
  Spanish. `test/i18n.test.js` checks it.
- **Widget images.** After any change to the content of a widget, run
  `docs/illustrations/render.sh` again and look at the four PNG files.
- **No copied code.** The protocol facts come from the official Adax
  documentation, pyAdax (MIT) and a Home Assistant issue, credited in NOTICE;
  no code is copied from them.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, the lockfile or the manifest, nor the `docker_image` tag.
  The version stays below 1.0.0 until the maintainer runs the Release workflow
  with `release-as: 1.0.0`.
- **Changelog.** Never edit CHANGELOG.md by hand, it is generated at the
  release. Write the PR title as the line the user will read.
- **Commits and PR titles** follow Conventional Commits, in English: `feat` ->
  minor, `fix` / `perf` -> patch, `!` or `BREAKING CHANGE:` -> major (minor
  below 1.0.0); `docs`, `chore`, `ci`, `test`, `style`, `refactor`, `build`
  release nothing.
- **Manifest.** Texts are objects `{ "en", "fr", "de", "es" }`; the catalog
  `description` holds 10 to 100 characters per language; the file stays under
  100 KB. `>=5.3.0` for `keywords`; no `countries` (Adax is sold across the
  Nordic countries, the Baltics, Poland, Germany, the UK…); no permission.
  Transport: `["cloud"]`.
- **CI smoke test.** `ci.yml` counts the features of a room with energy (6)
  and of a room without (3) in the Docker image: update it with the features.
- **Forum drafts** (`.github/forum-*.md`) are never committed.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
