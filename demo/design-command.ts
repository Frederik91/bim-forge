import type { WritableDesignTarget } from '../src/design-targets.ts';

type DesignCommand = { kind: 'capture'; projectId: string; target: WritableDesignTarget; revisionId: string; name: string }
  | { kind: 'fork'; projectId: string; baselineId: string; name: string };

/** A retry keeps its identity only while its complete command stays the same. */
export class DesignCommands {
  readonly #pending = new Map<DesignCommand['kind'], { fingerprint: string; id: string }>();
  constructor(private readonly createId: () => string = () => crypto.randomUUID()) {}
  id(command: DesignCommand): string {
    const fingerprint = JSON.stringify(command);
    const previous = this.#pending.get(command.kind);
    if (previous?.fingerprint === fingerprint) return previous.id;
    const id = this.createId(); this.#pending.set(command.kind, { fingerprint, id }); return id;
  }
  complete(kind: DesignCommand['kind']): void { this.#pending.delete(kind); }
}
