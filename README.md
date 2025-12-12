# timing-events Lenex exporter

This repository contains a small helper that turns JSON payloads from [timing.events](https://timing.events/) into Lenex XML. The conversion logic can run in two modes:

1. **With [`js-lenex`](https://github.com/Tiim/js-lenex)** (preferred) — if the dependency is installed, the exporter will call it to serialize the generated Lenex object.
2. **Manual fallback** — when the dependency is not available (for example in offline environments), the exporter produces a minimal Lenex-compliant XML document directly.

## Usage

Install dependencies in an environment with access to npm, then run the CLI:

```bash
npm install
npm run lint # optional placeholder
export-lenex input.json output.lenex
```

* `input.json` can be a local file or a direct `https://timing.events/...` URL that returns JSON.
* `output.lenex` is optional; when omitted the XML is printed to stdout.

You can also use the converter programmatically:

```js
const { buildLenexXml } = require('./src');

async function run(payload) {
  const xml = await buildLenexXml(payload);
  console.log(xml);
}
```

## Expected timing.events payload

The converter is designed to be forgiving because different timing.events endpoints can expose slightly different shapes. It looks for data in the following locations:

- Event metadata under `event`/`meet` (id, name, start/end date, city, nation)
- Clubs under `clubs`, `teams`, `clubList`, or inferred from `results`
- Athletes under `athletes`, `participants`, or inferred from `results`
- Sessions under `sessions` (each with `events`) or a top-level `events` array
- Results either nested per event or in a top-level `results` array filtered by `eventId`

Missing optional fields are simply omitted from the Lenex output.
