# Timing Events MQTT Listener

This repository contains a lightweight PHP script that subscribes to the MQTT broker at `timing.events:1883` and writes tag reads into a local SQLite database.

## Requirements
- PHP 8.0+ with SQLite enabled.

## Usage
1. Run the listener:
   ```bash
   php mqtt_listener.php
   ```
2. The script connects to the `finish` topic using the provided credentials (username `timing`, password `RFID#Data08`).
3. Each JSON payload published to `finish` is stored in `database.sqlite` with:
   - `TAGNAME`: value of `epc` (case-insensitive variants are accepted)
   - `TIMESTAMP`: value of `timestamp` (common casing variants accepted)
   - `RAW_JSON`: the full JSON payload

If the database file does not exist it will be created automatically with the required schema.

## Notes
- Dependencies are intentionally avoided to ensure the script can run in restricted environments.
- The script implements a minimal MQTT 3.1.1 client over TCP and keeps the connection alive with periodic PING requests.
