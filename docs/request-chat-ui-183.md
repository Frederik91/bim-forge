# Request conversation UI (#183)

Plan: reuse `room-app.ts`'s composer, source picker and single 2D/3D viewer. Mount the transcript component only in `#request-chat-mount`. `request-chat.ts` renders shared-schema messages, questions, immutable source links, proposal links and decisions. `request-chat-evidence.ts` converts the existing floor/wall marker into a model-coordinate pin bound to the displayed accepted or proposed snapshot. No geometry is authored by capturing evidence.

The app frame and panel placement belong to #184. This slice adds only the mount before the existing form and `request-chat.css`, whose selectors are scoped to the component. Runtime must serve `/request-chat.css` from `demo/request-chat.css`.

Acceptance evidence: server-only root validation and tests; deterministic evidence tests cover 2D wall and 3D storey pin coordinates, stable selection IDs, immutable proposal binding, no model mutation and rejection of stale/missing context. The integration owner runs question/reply/proposal/review and desktop/phone proof against the disposable server. Do not represent that proof as already completed here.

Reply submission keeps one message ID and exact CAS body while a network outcome is unknown. A definite conflict refreshes the conversation, retains the draft and files, and requires sending again against the new sequence. The UI never treats a reply or an assistant option as review approval. All saved messages and earlier proposals remain inspectable.
