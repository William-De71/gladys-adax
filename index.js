// -----------------------------------------------------------------------------
// Entry point of the Adax external integration.
//
// Adax WiFi panel heaters, through the official Adax remote user client API
// and a credential the user creates in the Adax WiFi app:
//   - devices: one per Adax room (setpoint, heating on / off, room
//     temperature, and, when the heaters report it, heating state, power and
//     an energy index), offered on the Discovery screen (see src/device.js);
//   - scene triggers: heating turned on / off, setpoint changed, from the
//     Adax app or the heater;
//   - scene actions: set the setpoint (one room or all), turn the heating on
//     or off (one room or all), read now;
//   - dashboard widgets: the rooms (with "All on" / "All off"), the energy of
//     the last 24 hours, the connection.
//
// This file only wires the SDK client: the handlers are in src/app.js.
//
// Environment variables provided by the Gladys supervisor:
//   GLADYS_HOST_API_URL / GLADYS_INTEGRATION_TOKEN / GLADYS_INTEGRATION_SELECTOR
//   TZ (the timezone of Gladys: the days of the energy widget)
// The SDK reads the first three: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';
import { createAdaxApi } from './src/adax-api.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const gladys = new GladysIntegration();
createApp(gladys, { api: createAdaxApi({ userAgent: `gladys-adax/${version}` }) });

// --- Startup -----------------------------------------------------------------------
logger.info(`Starting the Adax integration ${version}...`);
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
