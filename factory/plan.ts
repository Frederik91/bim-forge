export type ChangeClass = 'read-only' | 'metadata' | 'geometry' | 'coordination' | 'schema-storage' | 'security';
export type PlannerMode = 'fixture' | 'live';

export interface PlanningPlan {
  outcome: string;
  changeClass: ChangeClass;
  paths: string[];
  steps: string[];
  acceptanceChecks: string[];
  reviewers: string[];
  questions: string[];
}

type ListField = 'paths' | 'steps' | 'acceptanceChecks' | 'reviewers' | 'questions';

const fields: (keyof PlanningPlan)[] = [
  'outcome', 'changeClass', 'paths', 'steps', 'acceptanceChecks', 'reviewers', 'questions',
];
const fieldNames = new Set<string>(fields);
const listFields: ListField[] = ['paths', 'steps', 'acceptanceChecks', 'reviewers', 'questions'];
const changeClasses: ChangeClass[] = ['read-only', 'metadata', 'geometry', 'coordination', 'schema-storage', 'security'];

export const planSchema = {
  type: 'object',
  additionalProperties: false,
  required: fields,
  properties: {
    outcome: { type: 'string' },
    changeClass: { type: 'string', enum: changeClasses },
    ...Object.fromEntries(listFields.map((field) => [field, { type: 'array', items: { type: 'string' } }])),
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isChangeClass(value: unknown): value is ChangeClass {
  return value === 'read-only' || value === 'metadata' || value === 'geometry'
    || value === 'coordination' || value === 'schema-storage' || value === 'security';
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && Boolean(item.trim()));
}

function validateStringList(field: ListField, value: unknown): string[] {
  if (!isStringList(value)) throw new Error(`Plan ${field} must be an array of nonempty strings`);
  return value;
}

export function validatePlan(plan: unknown): PlanningPlan {
  if (!isRecord(plan)) throw new Error('Plan must be an object');
  if (Object.keys(plan).some((key) => !fieldNames.has(key))) throw new Error('Plan contains unknown fields');
  if (typeof plan.outcome !== 'string' || !plan.outcome.trim()) throw new Error('Plan needs an outcome');
  if (!isChangeClass(plan.changeClass)) throw new Error('Invalid change class');
  const validated: PlanningPlan = {
    outcome: plan.outcome,
    changeClass: plan.changeClass,
    paths: validateStringList('paths', plan.paths),
    steps: validateStringList('steps', plan.steps),
    acceptanceChecks: validateStringList('acceptanceChecks', plan.acceptanceChecks),
    reviewers: validateStringList('reviewers', plan.reviewers),
    questions: validateStringList('questions', plan.questions),
  };
  for (const file of validated.paths) {
    if (file.includes('\\') || file.startsWith('/') || /^[A-Za-z]:/.test(file) || file.split('/').includes('..')) {
      throw new Error('Plan paths must be relative to the repository');
    }
  }
  if (!validated.questions.length
      && (!validated.steps.length || !validated.acceptanceChecks.length || !validated.reviewers.length)) {
    throw new Error('A ready plan needs steps, acceptance checks, and reviewers');
  }
  return validated;
}

export function renderPlan(plan: PlanningPlan, mode: PlannerMode = 'fixture'): string {
  const provenance = mode === 'fixture'
    ? 'Simulation: fixture planner; no model was called.'
    : 'Live planning result. Advisory only; no implementation or approval was performed.';
  const lines = ['# Planning report', '', provenance, '', plan.outcome, '', `Change class: ${plan.changeClass}`];
  const headings: Record<ListField, string> = {
    paths: 'Affected paths',
    steps: 'Proposed steps',
    acceptanceChecks: 'Acceptance checks',
    reviewers: 'Required reviewers',
    questions: 'Open questions',
  };
  for (const field of listFields) {
    const items = plan[field];
    lines.push('', `## ${headings[field]}`, '', ...(items.length ? items.map((item) => `- ${item}`) : ['None.']));
  }
  return `${lines.join('\n')}\n`;
}
