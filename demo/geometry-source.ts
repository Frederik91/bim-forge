import type { GeometryRef } from '../src/geometry-contract.ts';
import { GeometryEvidenceConflict } from '../src/geometry-evidence.ts';
import type { GeometryEvidenceSource } from '../src/geometry-evidence.ts';
import { geometryDigest } from '../src/geometry-query.ts';
import type { LinkedModelStore } from './linked-model-store.ts';
import type { LinkedPrepared } from '../src/linked-model.ts';

type IFCRef = Extract<GeometryRef, { kind: 'ifc' }>;
type SourceStore = Pick<LinkedModelStore, 'snapshotCurrent' | 'resolveRetained' | 'withCatalogGuard'>;

/** Authorizes source data; geometry evaluation and replay remain in bounded workers. */
export function createGeometryEvidenceSource(options: {
  hasProject(projectId: string): boolean;
  links: SourceStore | null;
}): GeometryEvidenceSource {
  const authorize = (projectId: string): void => {
    if (!options.hasProject(projectId)) throw new GeometryEvidenceConflict('Unknown geometry project.');
  };
  const nativeToken = (projectId: string): string => geometryDigest({ projectId, linkedSources: 'unconfigured' });
  return {
    async snapshot({ projectId, native, signal, historicalRefs = [] }) {
      authorize(projectId); signal.throwIfAborted();
      if (historicalRefs.length > 4096 || historicalRefs.some(ref => ref.projectId !== projectId)) {
        throw new GeometryEvidenceConflict('Historical geometry references exceed their authorized domain.');
      }
      if (!options.links) {
        if (historicalRefs.length) throw new GeometryEvidenceConflict('Retained IFC sources are unavailable.');
        return { catalogToken: nativeToken(projectId), input: { projectId, native, linked: [] } };
      }
      const catalog = options.links.snapshotCurrent(projectId);
      const current = new Map(catalog.links.map(link => [
        JSON.stringify([link.prepared.manifest.source.namespace, link.prepared.manifest.occurrence.id]), link.prepared,
      ]));
      // Only consumed historical objects are resolved; never scan all retained meshes.
      const correspondences: { historical: IFCRef; current: IFCRef }[] = [];
      const seen = new Set<string>();
      const retainedVersions = new Map<string, LinkedPrepared>();
      for (const historical of historicalRefs) {
        signal.throwIfAborted();
        const key = geometryDigest(historical);
        if (seen.has(key)) continue;
        seen.add(key);
        const prepared = current.get(JSON.stringify([historical.namespace, historical.occurrenceId]));
        if (!prepared) continue;
        const now = prepared.index.objects.find(object => object.ref.globalId === historical.globalId);
        if (!now) continue;
        const versionKey = JSON.stringify([historical.namespace, historical.revision, historical.originalSha256,
          historical.occurrenceId, historical.placementDigest]);
        let retained = retainedVersions.get(versionKey);
        if (!retained) {
          const resolved = options.links.resolveRetained(projectId, historical);
          if (resolved.kind !== 'ok') continue;
          retained = resolved.prepared; retainedVersions.set(versionKey, retained);
        }
        const old = retained.index.objects.find(object => object.ref.globalId === historical.globalId);
        if (!old || old.ifcClass !== now.ifcClass) continue;
        correspondences.push({ historical, current: {
          kind: 'ifc', projectId, ...now.ref, occurrenceId: prepared.manifest.occurrence.id,
          placementDigest: geometryDigest(prepared.manifest.occurrence.sourceToProjectMetres),
        } });
      }
      signal.throwIfAborted();
      return { catalogToken: catalog.catalogToken, correspondences, input: {
        projectId, native, linked: catalog.links.map(link => link.prepared),
        unavailableSources: catalog.unavailable.map(source => ({ id: source.linkId, reason: source.reason })),
      } };
    },
    withCatalogGuard(projectId, catalogToken, commit) {
      authorize(projectId);
      if (options.links) return options.links.withCatalogGuard(projectId, catalogToken, commit);
      if (catalogToken !== nativeToken(projectId)) return { kind: 'catalog-changed' };
      const value = commit();
      if (value !== null && (typeof value === 'object' || typeof value === 'function') && 'then' in value) {
        throw new GeometryEvidenceConflict('Geometry publication must commit synchronously.');
      }
      return { kind: 'committed', value };
    },
  };
}
