import type { ModelWorker } from '../../src/model-proposal.ts';

/** Deterministic questions and intentions, real ScriptBox execution and model validation. */
export const conversationWorker: ModelWorker = {
  identity: { provider: 'integration-fixture', model: 'persistent-conversation' },
  async run(session) {
    const input = session.input;
    if (typeof input !== 'object' || input === null || !('request' in input)
      || typeof input.request !== 'object' || input.request === null || !('instruction' in input.request)
      || typeof input.request.instruction !== 'string') throw new Error('Missing fixture request instruction.');
    const source = input.request.instruction.includes('1800 mm') ? `
      await model.inspect();
      await model.previewParameters({edits:[{definitionId:'geometry-width',name:'Width',value:{kind:'length',value:1800,unit:'mm'}}]});
      return {kind:'propose',review:{summary:'Widen the selected office desk to 1800 mm.',
        rationale:'Use the clarified width and retain the accepted model until explicit review.',
        constraints:'Only the frozen desk target may change. Preserve other rooms, devices, and prior requirements.',
        uncertainty:'Deterministic integration fixture. This is not a construction approval.',
        intent:{interpretation:'Set the office desk width to 1800 mm.',assumptions:[],certainty:100,basis:'The user answered the width question.'}}};
    ` : `return {kind:'clarify',question:'What width should the selected desk have?',options:['1800 mm','Keep current width']};`;
    const result = await session.executeTool('run_model_script', { language: 'typescript', source });
    if (!result.ok) throw new Error(`Conversation qualification script failed: ${JSON.stringify(result)}`);
  },
};
