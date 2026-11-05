# Contributing

Run pnpm check before submitting a change. Keep package.json and the app manifest versions aligned.
Commit pnpm-lock.yaml with dependency changes. Keep credentials out of source files.

- src/model.ts: application state and behavior.
- src/lib.ts: validation, formatting and model primitives.
- src/main.ts: device input, display, persistence, audio and HTTP lifecycle.
- src/appmeta/settings.json: settings schema.
- tests/: behavior and packaged runtime checks.
- art/generate_assets.py: reproducible original assets.

Use a schema version change and explicit migration when changing the meaning of stored settings.
Describe device verification with the application, firmware and HTTP API versions.
