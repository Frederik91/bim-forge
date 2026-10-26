import type { ModelWorker } from '../../src/model-proposal.ts';

/** Deterministic qualification agent; all execution and validation use real ScriptBox. */
export const scopedHouseWorker: ModelWorker = {
  identity: { provider: 'integration-fixture', model: 'scoped-house-parameters' },
  async run(session) {
    const result = await session.executeTool('run_model_script', { language: 'typescript', source: `
      const bound = await model.scope();
      if (!bound.scope?.targetIds.length) throw new Error('This qualification requires frozen targets.');
      const desk = bound.scope.targetIds.includes('office-desk');
      await model.inspect();
      await model.previewParameters({edits:[desk
        ? {definitionId:'geometry-width',name:'Width',value:{kind:'length',value:1800,unit:'mm'}}
        : {definitionId:'geometry-height',name:'Height',value:{kind:'length',value:1900,unit:'mm'}},
        {definitionId:'inspection-interval',name:'Inspection interval',value:{kind:'duration',value:2,unit:'h'}}]});
      return {kind:'propose',review:{summary:desk?'Widen the office desk to 1.8 m.':'Set frozen objects to 1.9 m tall.',
        rationale:'Apply explicit dimensions and a typed inspection interval to the frozen targets.',
        constraints:'Preserve context, supported objects, family recipes and unrelated changes.',
        uncertainty:'Deterministic qualification fixture; engineering review is still required.',
        intent:{interpretation:'Edit the frozen parameter targets.',assumptions:[],certainty:100,basis:'Explicit qualification dimensions.'}}};
    ` });
    if (!result.ok) throw new Error(`The qualification script failed: ${JSON.stringify(result)}`);
  },
};
