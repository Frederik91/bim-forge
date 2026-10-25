# Device authorization integration

The maintainer approved PR #67 for the combined server preview on 25 October 2026; integration is tracked in #119.

Its device-authorization work is incorporated through the current `src/codex-app-server.ts`, server-owned account state and the QR/device-pairing interface introduced by #88. Users connect from the app through the OpenAI device flow without installing a local npm package or supplying an API key. Authentication credentials remain on the server, outside static assets and runtime images.

The newer backlog owns acceptance and revision navigation. The historical helper that redirected acceptance to a local-history page is superseded by the durable server decision and backlog workflow. No duplicate authentication implementation or obsolete review-navigation module is retained.

The combined code passed validation and all 441 unique tests in server containers. The production image passed 15 real ScriptBox tests with networking disabled, a read-only root and its restricted user. Deployment preserves the existing account directory and model database, with a private server-side backup before replacement. The release checks the public session and performs a disposable live proposal after startup; its result is recorded in #119.
