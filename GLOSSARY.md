# BIM Forge model review

## Language

**Project**:
A named building-model study and its revision history.

**Entity**:
A building object with a stable identity across revisions, such as a wall or door.

**Relationship**:
An identified connection between entities, such as a door being hosted by a wall.

**Snapshot**:
The complete set of entities and relationships at one point in a model's history.

**Revision**:
An immutable snapshot linked to its parent revision. The first revision has no parent.

**Branch**:
A named reference to a revision that identifies a line of work.

**Proposal**:
A change saved on a separate branch for comparison with its source, without replacing the original.

**Semantic delta**:
The added, removed, or modified entities and relationships between two snapshots.
_Avoid_: Text diff

**Conflict**:
Different changes to the same entity or relationship in proposals with a shared ancestor, requiring a review decision.
