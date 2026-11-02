# Inside: hold left and drag to look (#290)

## Behavior and scope

Hold the primary mouse button on the Inside canvas and drag to turn yaw/pitch without moving the eye or acquiring pointer lock. Movement within five CSS pixels remains a selection click; crossing that threshold consumes the selection gesture. Releasing the button, Escape, focus loss, pointer cancellation and lost capture stop rotation. Active markup keeps ownership of drawing. Automatic drag is mouse-only; Overview and explicit pointer-lock mouse-look retain their existing controls.

Files: `demo/view-navigation.ts`, `demo/model-viewer.ts`, `demo/index.html`, and `demo/view-navigation-browser.test.ts`.

Model delta: zero. Camera state only; no geometry, schema, validators, persisted project state or agent placement changes.

## Linux evidence

The real-viewer browser regression at test-only commit `196b8e11c183004fd751c60ccd6d354fe7a0ac70` fails on the original navigation: dragging leaves forward equal to `[0,1,0]`. At implementation commit `0b6c5e20390b81fb9d43a0a8c8bc1f379dbb1939`, the same test passes (1/1, 21.1 seconds).

The regression exercises actual browser input for small-click selection, automatic drag, unchanged eye, no selection on drag, release, Escape, focus loss, pointer cancellation, lost capture and rectangle drawing priority. It retains the existing WASD, Fly vertical keys, input/modal isolation, Walk blocking, view/session transitions, explicit mouse-look, denied-lock fallback and polyline completion assertions.

Run on the Linux VM as `bimforge`, with Playwright browsers in `/var/lib/bim-forge/previews/browser-cache`:

```sh
npm run validate
PLAYWRIGHT_BROWSERS_PATH=/var/lib/bim-forge/previews/browser-cache \
XDG_CACHE_HOME=/var/lib/bim-forge/previews/browser-cache \
node --test demo/view-navigation-browser.test.ts
```

Validation passes: strict TypeScript (385 sources), typecheck and policy. Browser fixtures and app servers run exclusively on Linux; Windows is only the SSH/browser client.

## Integrated preview

Linux release `/var/lib/bim-forge/previews/releases/walk-left-drag-ad08d17`, source `ad08d17e8838c632141ed95f5fc1bf62df52f19d`, combines this change with the existing native Walk, toolbar and shell fixes. Strict validation (389 sources) and demo build pass. The sequential browser run passes 3/3: native doors/stairs with retained task context; stable spatial shell; navigation and markup regression.

The live app at `http://127.0.0.1:4191/`, forwarded to Linux loopback, passes automatic left-drag in both Walk and Fly, unchanged eye, release and Escape cancellation, and no pointer lock. One canvas, zero page errors, zero mutation requests, and identical project API snapshots before/after. The first live script targeted a composer overlay rather than exposed canvas; the corrected script asserts the actual hit target before dragging.

Service: `bim-forge-walk-preview.service`, owner `bimforge`, Linux PID `28991`. Existing data remains at `/var/lib/bim-forge/previews/data/walk-284`. Bundle SHA-256: `f873493ec08722f91c2a436c080f9c96bedd5fba6233b709fd56a7d1f741140e`. Raw logs, live result JSON and screenshot are retained under the client evidence directory `BIMForge/drag-290-evidence` in Local AppData.

## Review

Draft change based on main `f068208b7c195d515abc9d74caa243520cbaab2b`. The preview integration also retains the separate native Walk, grouped toolbar and stable spatial shell fixes. No merge or issue closure is authorized by this change.
