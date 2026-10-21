const fields = ['outcome', 'changeClass', 'paths', 'steps', 'acceptanceChecks', 'reviewers', 'questions'];
const changeClasses = ['read-only', 'metadata', 'geometry', 'coordination', 'schema-storage', 'security'];

export const planSchema = {
  type: 'object', additionalProperties: false, required: fields,
  properties: {
    outcome: { type: 'string' }, changeClass: { type: 'string', enum: changeClasses },
    ...Object.fromEntries(['paths', 'steps', 'acceptanceChecks', 'reviewers', 'questions'].map((field) => [field, { type: 'array', items: { type: 'string' } }])),
  },
};

export function validatePlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('Plan must be an object');
  if (Object.keys(plan).some((key) => !fields.includes(key))) throw new Error('Plan contains unknown fields');
  if (typeof plan.outcome !== 'string' || !plan.outcome.trim()) throw new Error('Plan needs an outcome');
  if (!changeClasses.includes(plan.changeClass)) throw new Error('Invalid change class');
  for (const field of ['paths', 'steps', 'acceptanceChecks', 'reviewers', 'questions']) {
    if (!Array.isArray(plan[field]) || plan[field].some((value) => typeof value !== 'string' || !value.trim())) {
      throw new Error(`Plan ${field} must be an array of nonempty strings`);
    }
  }
  for (const file of plan.paths) {
    if (file.includes('\\') || file.startsWith('/') || /^[A-Za-z]:/.test(file) || file.split('/').includes('..')) {
      throw new Error('Plan paths must be relative to the repository');
    }
  }
  if (!plan.questions.length && (!plan.steps.length || !plan.acceptanceChecks.length || !plan.reviewers.length)) {
    throw new Error('A ready plan needs steps, acceptance checks, and reviewers');
  }
  return plan;
}

export function renderPlan(plan, mode = 'fixture') {
  const provenance = mode === 'fixture' ? 'Simulation: fixture planner; no model was called.' : 'Live planning result. Advisory only; no implementation or approval was performed.';
  const lines = ['# Planning report', '', provenance, '', plan.outcome, '', `Change class: ${plan.changeClass}`];
  const headings = { paths: 'Affected paths', steps: 'Proposed steps', acceptanceChecks: 'Acceptance checks', reviewers: 'Required reviewers', questions: 'Open questions' };
  for (const [field, heading] of Object.entries(headings)) {
    lines.push('', `## ${heading}`, '', ...(plan[field].length ? plan[field].map((item) => `- ${item}`) : ['None.']));
  }
  return `${lines.join('\n')}\n`;
}
