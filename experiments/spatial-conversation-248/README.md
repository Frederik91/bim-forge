# Spatial conversation interaction study

This development-only study explores the [product vision](../../docs/product-vision.md#a-multiplayer-building-workspace). It is separate from the shipped demo. The room is synthetic, conversations live in browser memory, and people and agent replies are simulated.

## Run the study

From the repository root, install the locked dependencies, build, and start the local preview:

```powershell
npm ci
node experiments/spatial-conversation-248/build.ts
node experiments/spatial-conversation-248/serve.ts
```

Open http://127.0.0.1:4188. The server binds to loopback and serves only the study HTML, CSS, and built JavaScript. Stop it with Ctrl+C. Generated code goes under ignored `dist/`, outside source directories.

## Review the interaction

Begin Inside the room. Select the entry door and start a task at its location. Collapse it to a marker, inspect the adjoining wall task, and return through the conversation list. Switch to Plan or Section and return Inside to assess whether the view preserves orientation and the task remains understandable.

Use the explicit width example to inspect an illustrative 900 to 1100 mm door overlay. It is not an interpretation of arbitrary text or a validated model proposal. Text replies are canned demonstrations. No control applies a model change.

The audience and recipient controls explore whether people can distinguish task agents, human conversation, and visibility choices. These controls are not authorization enforcement. Voice is labeled as a concept and does not request microphone access, record, transcribe, or make calls. No multiplayer session, real agent, or shared project store is connected.

## Evidence and limits

The [design brief](../../docs/design/model-centered-language-248.md) records the review scenario, findings, and remaining work. Browser verification must use the built study, including a narrow viewport and keyboard interaction. Source validation alone does not qualify the experience. The study is not a final design system or a production implementation.
