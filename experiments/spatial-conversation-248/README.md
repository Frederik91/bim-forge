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

Begin Inside the room. Selecting the entry door starts a task and creates a hovering 3D agent near that starting point. Collapse the conversation and select the agent's body or name label to reopen it and highlight the associated door. The agent stays at its conversation origin rather than following later selections. Mira's wall task has a separate agent. The conversation list also returns to these task locations.

Plan borrows the Shared studio drawing details while retaining this study's actual room: wall outlines, bench and table, partition, door swings, labels, overall and opening dimensions, a projected one-metre scale, and orientation. Its 6000 by 4000 mm dimensions are to wall axes. The reference's unrelated bedroom and kitchen layout is not imported. Switch between Plan, Section and Inside to inspect the same task and geometry.

Focus the model and use WASD or arrows to walk. Drag to look, or enable **Mouse look** to turn with the mouse continuously. Press Escape to release the cursor. In captured mouse-look, click the aimed object to select it. Browsers that refuse cursor capture retain drag-to-look and Q/E turning.

Toggle **Fly** for free roam. WASD follows your facing direction, **Shift rises**, and **Ctrl descends**. Space no longer controls ascent and Shift is no longer a speed boost. Flight can pass through geometry and leave the room. Toggle Fly off to return to grounded walking, or use **Frame room** to return to the room or selected task. Inside pose and flight mode survive a Plan or Section switch. Typing and loss of model focus stop movement.

Use the explicit width example to inspect an illustrative 900 to 1100 mm door overlay. It is not an interpretation of arbitrary text or a validated model proposal. Text replies are canned demonstrations. No control applies a model change.

The audience and recipient controls explore whether people can distinguish task agents, human conversation, and visibility choices. These controls are not authorization enforcement. Voice is labeled as a concept and does not request microphone access, record, transcribe, or make calls. No multiplayer session, real agent, or shared project store is connected.

## Evidence and limits

The [design brief](../../docs/design/model-centered-language-248.md) records the review scenario, findings, and remaining work. Browser verification must use the built study, including a narrow viewport and keyboard interaction. Source validation alone does not qualify the experience. The study is not a final design system or a production implementation.
