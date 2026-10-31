# Product

<!-- impeccable:product-schema 1 -->

The [product vision](docs/product-vision.md) is the authority for the intended end-user experience. This record captures the confirmed context for design work.

## Platform

web

## Users

People authoring, exploring and reviewing BIM models with an AI agent. Primary role segmentation and desktop versus mobile priorities remain open.

## Product Purpose

The model is the shared workspace between person and agent. Users view 2D and 3D while discussing, exploring and proposing model changes. The model must remain continuously available: hiding it breaks the user's sense of connection to their work.

BIM Forge should feel like a multiplayer building workspace. Many engineers can explore the building, start task conversations that assign agents, and encounter permitted activity in the model. Multiple concurrent tasks can concern the same place. Agents coordinate overlapping dependencies within their visibility and authority limits.

## Positioning

Human intent drives AI-proposed model changes. People inspect proposals, request revisions and decide whether to accept them. The conversation is grounded in the objects and regions being viewed.

## Operating Context

Text and voice are intended ways to express intent. Future VR is a consideration; neither voice nor VR implementation is asserted by this record. Users need to distinguish existing geometry, explored alternatives, proposed changes and accepted results without losing spatial orientation.

Being inside the building is the primary intended spatial experience. Plan, section, elevation, and overview remain readily available and preserve location, selection, and task context across view changes. Direct navigation to places and tasks complements movement through the building.

Built-in human voice chat, text chat, and private conversations let participants communicate without finding contact details in an external calling application. The interface distinguishes human recipients from agent instructions. Voice transport, proximity audio, recording, transcription, and retention remain open design decisions.

Conversation visibility includes personal, discipline, and company audiences. Personal conversations reveal neither their content nor their existence to other participants. Detailed privacy rules remain open. Presence and agent coordination must respect the selected visibility scope.

## Capabilities and Constraints

Current main at bc7fbd3 includes a React Canvas Studio shell, 2D/3D viewing, request conversations and proposal review. Existing domain controllers own model changes and acceptance; presentation must not manufacture readiness, validation or acceptance facts. No deployment or production model changes are part of design exploration.

## Brand Commitments

Name: BIM Forge. The maintainer explicitly permits rethinking the current layout, interaction and visual identity. No existing palette or arrangement is binding.

## Evidence on Hand

Current workspace reference: docs/design/canvas-studio-241.md and its desktop, phone and proposal captures. The earlier Room studies critique assessed 4688cf6 and is historical evidence, not proof of current defects. Concept examples must be labeled synthetic; measurements and agent output in concepts are illustrative.

## Product Principles

- Keep the model present through conversation and review.
- Make the current visual and selection context shared and explicit.
- Conversations belong to objects or spatial areas in the model. Selecting a place starts text or voice interaction there; persistent spatial markers make those conversations discoverable on return. A secondary list provides retrieval and takes users back to the relevant place.
- Make proposed and accepted changes distinguishable.
- Preserve human authority over consequential model changes.
- Derive the design system from a tested workspace direction.

## Open Decisions

Primary device/use context, precise user-role priorities and visual language remain open. The maintainer rejected a permanently separate assistant panel as the primary interaction because it takes attention outside the model context. Spatial conversation is the chosen interaction direction; design-system adoption follows review of that interaction. Privacy defaults and audience membership, private-to-shared publication, presence representation, and cross-agent coordination protocols require later design.
