# Resizable Assistant and understandable settings (#293)

## Behavior

The floating Assistant has a lower-left Resize handle. Drag left/right to change width and down/up to change height. Arrow keys do the same in 16 px steps; Shift uses 32 px steps; Home restores the default. Expand conversation remains a size preset. Pointer release, cancellation, capture loss and window blur end a resize gesture.

Manual dimensions and placement remain stable during task changes, input and model-selection updates. The card stays within the model stage; shrinking the viewport clamps its visible size and returning to desktop restores the chosen dimensions. No camera or model state is involved.

Request options is now collapsed **Advanced settings**, with a short default instruction: select an object or draw markup and describe the change. Its sections explain their purpose:

- **Limit changes to matching objects:** filters for a group, such as all doors on a storey, with target preview before sending.
- **Rebuild a floor layout:** explicit permission for walls/rooms, storeys, stairs or roof reconstruction. Ordinary object changes leave it off.
- **Name this request:** optional; the normal flow generates a name automatically.
- **Inspect references and coordinates:** advanced inspection of object, location and evidence context.

All existing field identities, values, unchecked defaults, validation and request/review contracts are retained. Model delta: zero. No schema, persistence, model authoring or deployment changes.

## Qualification

Linux VM, isolated source `c214c0cb978f730a6d9b11c9d566a6adf8bada64` at `/var/lib/bim-forge/previews/checks/card293-c214c0c`:

```text
npm run validate
Strict TypeScript valid. 386 source file(s) checked.
tsc --noEmit: passed
Policy valid. 0 changed file(s) checked.

npm run build:demo: passed
node --test demo/assistant-card-browser.test.ts
tests 1 / pass 1 / fail 0 (28.4 seconds)
```

Playwright used the real app, server, model viewer and fixture worker. It verified pointer and keyboard resizing, Home reset, stable dimensions after selection and an independent chat, explicit reconstruction opt-in/opt-out, normal submission without `authoringScope` or `scope`, one connected canvas, unchanged eye/facing during resizing, and visible/hittable resize controls without overflow at 800, 390 and 320 px. Desktop dimensions return after narrow viewport checks. Zero page errors.

The new browser test is included in `test:spatial-workspace` and the Linux browser qualifier's default list. All app/fixture servers ran on Linux; Windows was only an SSH and evidence-viewing client. No running preview service or user project was modified by qualification.

Desktop and 320 px screenshots were visually inspected together. The resize footer, transcript, composer and review actions remain legible and reachable. The existing toolbar/picker overlap belongs to separate #286 and is unchanged on this main-based branch.

The required Impeccable detector ran once over the changed UI targets. It reported existing page-wide legacy warnings from the full HTML surface, including contrast, small text and decorative surfaces outside this change. This is not a claim of a clean page-wide design audit; the scoped implementation reuses the approved tokens, 44 px controls and current panel identity.

Raw logs, detector output and screenshots are retained in the client's Local AppData `BIMForge/assistant-card-293-evidence` directory. No merge or issue closure is authorized by this evidence.

## Minimum-size completion

A subsequent integration review identified that the original 260 px manual floor could hide the composer when task controls wrapped. The regression was reproduced on Linux at combined test-only commit `544be835584d1156409fba6ab743390cd50045a1`: at 320 × 900, wrapped controls occupied 92 px, the resize footer 45 px, and the content region only 16.8 px. The transcript height was zero; actual textarea and Send center hits were false. The captured screenshot shows the composer missing below the footer.

The size owner now measures visible fixed chrome, task toolbar and the actual input row. It reserves a 96 px transcript region and enough composer height to show the input and Send, rather than allowing a fixed minimum that cannot contain them. A ResizeObserver keeps the calculation current when tools wrap, notices change, or the input grows. This includes additional task controls without hard-coding their count. If the viewport cannot physically fit that minimum, the content region deliberately scrolls while the header and resize handle remain reachable. Requested manual size remains separate from its viewport clamp.

The unchanged failure assertions now pass:

```text
Combined source 05c18b94630e1d696e3c7bc272cff236b5f2985c:
  validation: 390 sources; build passed
  browser: 1 passed / 0 failed (28.3s)
  320 px minimum: card 494 px, transcript 97 px, textarea hit true, Send hit true

Standalone #293 source a1f6b9a2f0f2841c7cac5389a8ee19a2bed0cec3:
  validation: 386 sources; build passed
  browser: 1 passed / 0 failed (38.3s)
  320 px minimum: card 446 px, transcript 97 px, textarea hit true, Send hit true
```

Both runs also prove actual textarea, Send and transcript hit targets through the deliberate scrolling fallback at 320 × 600. Zero page errors. The regression opens task mode when the always-available personal assistant integration exists; the standalone branch retains its original workflow. Existing camera, single-canvas, viewport, resizing and request-permission checks remain in the same test.

Red, minimum-size green and short-viewport green screenshots were inspected together. The focused detector over the changed sizing/CSS targets returned `[]`. Logs and captures are retained under Local AppData `BIMForge/assistant-card-293-minimum-evidence`; the original full-page detector limitations above remain applicable. All fixtures ran on Linux; no shared preview service or project data was changed.
