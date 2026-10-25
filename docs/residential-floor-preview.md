# Residential floor preview

The residential starter is a connected 12 m by 9 m ground-floor concept with eight spaces: living room, kitchen/dining, home office, hallway, two bedrooms, bathroom and utility. Measurements and generic furnishings are illustrative, not evidence about the user's house.

## Explore and request changes

Choose **New project → Residential ground floor**. The project overview shows the whole plan and a room directory. Open the whole floor or choose a room to frame it in Plan or 3D. Room focus accompanies requests as a stable selected Space identity. It changes presentation, not permissions or accepted geometry.

The agent can replace a room's furnishing set without touching other rooms. Explicit transfers between rooms use the whole-floor furnishing tool and retain object identities. Locations and selections communicate intent; they never authorize unrelated changes. Work enters the durable backlog, reports structured activity and produces a separate, rotatable 3D delta for human review.

## Model and checks

Level and Space are ordinary versioned entities. Spaces reference their level and declare rectangular centre-line bounds. Adjacent spaces use the same Wall entities; door adjacency is derived from validated wall hosts and opening endpoints.

The current validator checks one level at elevation zero, two to twelve non-overlapping rectangular spaces covering a rectangular footprint, complete boundary walls, no walls through room interiors or duplicate overlapping wall segments, non-overlapping hosted openings, and a doorway path from every room to the exterior. Furnishing footprints must fit wholly inside one space clear of wall thickness; supports, collisions and doorway clearance on both sides are checked. Areas use wall centre lines, not certified net usable areas.

Older single-room snapshots are not rewritten or populated with implicit levels/spaces. Their revision hashes and serialized data remain unchanged. New entities and room-tool evidence are additive to the current repository format; older runtimes cannot read a residential project. Export residential projects before rolling back the application. Rollback does not erase stored projects or tickets.

## Limits

This slice supports furnishing proposals, not moving shared partitions or resizing a multi-room shell. The rectangle tool refuses multi-room models. It does not provide multi-storey design, stairs, arbitrary room polygons, IFC, surveyed dimensions, detailed kitchens/sanitary systems or construction, fire, accessibility, structural or regulatory approval. Generic beds, sofas and cabinetry provide spatial scale rather than product-accurate documentation.

Preview limits remain 100 entities, 32 furnishings, 32 revisions and 256 KiB per project. A complete multi-room snapshot is stored per revision, so export and start a fresh study when the bounded history fills. No persistence-limit increase or production migration is hidden in this feature.
