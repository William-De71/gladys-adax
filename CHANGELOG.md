# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/). This file is generated at
each release from the Conventional Commits: do not edit it by hand.

## [0.1.0] - 2026-10-28

### Added

- Adax WiFi heaters through the official Adax remote user client API, with the account id and a credential created in the Adax WiFi app; every room read in one request every 1, 2, 5 or 10 minutes, a "Test the connection" button.
- One device per Adax room: setpoint (5 to 35 °C by whole degrees), heating on or off, room temperature, and, when the heaters report their energy, heating now, average power and an energy index that Gladys turns into a consumption and a cost.
- Commands shown at once and sent within 30 seconds, every room waiting in one control request (Adax accepts one request every 30 seconds); 402 answers slow the readings down instead of insisting.
- Scene triggers: heating turned on or off, setpoint changed, from the Adax WiFi app, the heater or its schedule; each one filtered by room.
- Scene actions: set the setpoint of one room or of all of them, turn the heating on or off, read the rooms now.
- Dashboard widgets: the rooms (temperature, setpoint, heating, power, details on tap, "All on" and "All off"), the energy of today, of yesterday and of the last 24 hours, and the connection to the Adax API.
- English, French, German and Spanish everywhere: settings, devices, widgets, scenes and documentation.

[0.1.0]: https://github.com/William-De71/gladys-adax/releases/tag/v0.1.0
