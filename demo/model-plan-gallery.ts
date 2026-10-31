import { createModelPlan, hitTestModelPlan, renderModelPlan } from './model-plan.ts';
import { planFixture } from './model-plan-fixture.ts';
import { spatialTokens } from './ui/design-tokens.ts';

const fixture = planFixture();
const title = document.createElement('h1'); title.textContent = 'Native Plan · source geometry';
const controls = document.createElement('div'); const level = document.createElement('select');
level.setAttribute('aria-label', 'Plan level');
for (const item of fixture.source.snapshot.entities.filter(item => item.type === 'Level')) {
  const option = document.createElement('option'); option.value = item.id; option.textContent = item.name;
  option.selected = item.id === fixture.levelId; level.append(option);
}
const comparison = document.createElement('input'); comparison.type = 'checkbox'; comparison.checked = true;
const label = document.createElement('label'); label.append(comparison, ' Compare 900 → 1100 mm door');
const drawing = document.createElement('div'); const detail = document.createElement('p'); const notices = document.createElement('p');
detail.setAttribute('role', 'status'); detail.textContent = 'Select geometry to inspect its source revision.';
controls.append(level, label); document.body.append(title, controls, drawing, detail, notices);
document.body.style.cssText = `margin:0;padding:12px;background:${spatialTokens.color.paper};color:${spatialTokens.color.ink};font:14px/1.45 ${spatialTokens.font.ui}`;
title.style.cssText = 'font-size:18px;margin:0 0 16px'; controls.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-bottom:12px';
level.style.cssText = `min-height:44px;color:${spatialTokens.color.ink};background:${spatialTokens.color.paper};border:1px solid ${spatialTokens.color.border};border-radius:${spatialTokens.radius.control};font:inherit`;
label.style.cssText = 'display:flex;align-items:center;min-height:44px'; notices.style.cssText = 'max-width:75ch';
function render(): void {
  const plan = createModelPlan({ ...fixture, levelId: level.value, comparison: comparison.checked ? fixture.comparison : null,
    viewport: { width: Math.min(document.documentElement.clientWidth - 24, 1000), height: 600 } });
  const svg = renderModelPlan(document, plan); drawing.replaceChildren(svg); notices.textContent = plan.notices.join(' ');
  svg.addEventListener('click', event => {
    const rect = svg.getBoundingClientRect();
    const point: [number, number] = [(event.clientX - rect.left) * plan.width / rect.width, (event.clientY - rect.top) * plan.height / rect.height];
    const hit = hitTestModelPlan(plan, point)[0];
    detail.textContent = hit ? `${hit.name} · ${hit.ref.entityId} · ${hit.revisionRole} · ${hit.ref.revisionId.slice(0, 8)} · ${hit.representation}`
      : `Project point: ${plan.projection.inverse(point).point.map(value => value.toFixed(3)).join(', ')} m`;
  });
}
level.addEventListener('change', render); comparison.addEventListener('change', render); window.addEventListener('resize', render); render();
