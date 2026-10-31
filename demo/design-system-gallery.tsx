import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, ArrowRight, Check, CircleHelp, MessageSquare } from 'lucide-react';
import { Button } from './ui/button.tsx';
import { SpatialPanel, StateLabel, TaskIdentity, WorkspaceNotice } from './ui/spatial-primitives.tsx';
import type { TaskTone } from './ui/spatial-primitives.tsx';
import { spatialTokens as tokens } from './ui/design-tokens.ts';
import type { SnapshotV2 } from '../src/room-model.ts';

// The build validates this native fixture before embedding it in the gallery document.
declare const GALLERY_SNAPSHOT: SnapshotV2;
const snapshot = GALLERY_SNAPSHOT;
const states: { label: string; tone: TaskTone; detail: string }[] = [
  { label: 'Queued', tone: 'neutral', detail: 'Waiting for an execution slot.' },
  { label: 'Working', tone: 'active', detail: 'A bounded worker attempt is running.' },
  { label: 'Needs input', tone: 'waiting', detail: 'Confirm the required clear opening.' },
  { label: 'Failed', tone: 'error', detail: 'The attempt failed. Your message is retained.' },
  { label: 'Ready for review', tone: 'ready', detail: 'Inspect the proposal before deciding.' },
  { label: 'Accepted', tone: 'settled', detail: 'Decision recorded by the server.' },
  { label: 'Rejected', tone: 'neutral', detail: 'Proposal rejected; conversation retained.' },
  { label: 'Cancelled', tone: 'neutral', detail: 'Cancellation recorded; cleanup may still be draining.' },
];

function NativeDrawing() {
  const c = tokens.color, d = tokens.drafting;
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(560);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const observer = new ResizeObserver(entries => {
      const measured = entries[0]?.contentRect.width;
      if (measured && measured > 0) setWidth(measured);
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);
  const labelSize = d.dimensionText * 560 / width;
  const walls = snapshot.entities.filter(entity => entity.type === 'Wall').filter(wall => wall.levelId === 'ground');
  const spaces = snapshot.entities.filter(entity => entity.type === 'Space').filter(space => space.levelId === 'ground');
  const door = snapshot.entities.find(entity => entity.type === 'Door' && entity.id === 'ground-door');
  const host = snapshot.relationships.find(relationship => relationship.type === 'hosted-by' && relationship.source === 'ground-door');
  const x = (value: number) => 70 + value * 70;
  const y = (value: number) => 365 - value * 70;
  return <svg ref={svgRef} className="gallery-drawing" viewBox="0 0 560 455" role="img" aria-labelledby="native-drawing-title native-drawing-description">
    <title id="native-drawing-title">Validated native building fixture, ground floor</title>
    <desc id="native-drawing-description">Six by four metre wall axes, two rooms and an 800 millimetre door hosted by the shared wall. Drafting specimen only; dimensions derived from fixture geometry.</desc>
    <rect width="560" height="455" fill={c.drawingPaper} />
    <rect x={x(0)} y={y(4)} width={420} height={280} fill={c.floor} />
    {walls.map(wall => <g key={wall.id}>
      <line x1={x(wall.start[0])} y1={y(wall.start[1])} x2={x(wall.end[0])} y2={y(wall.end[1])} stroke={c.drawingInk} strokeWidth={wall.thickness * 70 + d.cut} />
      <line x1={x(wall.start[0])} y1={y(wall.start[1])} x2={x(wall.end[0])} y2={y(wall.end[1])} stroke={c.wall} strokeWidth={wall.thickness * 70} />
    </g>)}
    {door?.type === 'Door' && host?.type === 'hosted-by' && <g>
      <line x1={x(3)} y1={y(host.offset)} x2={x(3)} y2={y(host.offset + door.width)} stroke={c.floor} strokeWidth={12} />
      <path d={`M ${x(3)} ${y(host.offset)} l ${-door.width * 70} 0 a ${door.width * 70} ${door.width * 70} 0 0 1 ${door.width * 70} ${-door.width * 70}`}
        fill="none" stroke={c.selection} strokeWidth={d.selected} strokeDasharray={d.existingDash} vectorEffect="non-scaling-stroke" />
      <text x={x(3) + 15} y={y(host.offset + door.width / 2)} fill={c.selection} fontSize={labelSize}>D · {door.width * 1000} mm</text>
    </g>}
    {spaces.map(space => <g key={space.id} fill={c.drawingInk} textAnchor="middle">
      <text x={x((space.bounds.minX + space.bounds.maxX) / 2)} y={y(2.9)} fontSize={labelSize} fontWeight="600">{space.name}</text>
      <text x={x((space.bounds.minX + space.bounds.maxX) / 2)} y={y(2.9) + labelSize * 1.6} fontSize={labelSize} fill={c.drawingMuted}>
        {(space.bounds.maxX - space.bounds.minX) * (space.bounds.maxY - space.bounds.minY)} m²
      </text>
    </g>)}
    <g stroke={c.drawingMuted} strokeWidth={d.dimension} fill="none">
      <path d={`M ${x(0)} 78 V 42 M ${x(6)} 78 V 42 M ${x(0)} 52 H ${x(6)}`} />
      <path d={`M ${x(0) - 4} 56 l 8 -8 M ${x(6) - 4} 56 l 8 -8`} />
      <path d={`M 59 ${y(0)} H 29 M 59 ${y(4)} H 29 M 39 ${y(0)} V ${y(4)}`} />
      <path d={`M 35 ${y(0) + 4} l 8 -8 M 35 ${y(4) + 4} l 8 -8`} />
    </g>
    <g fill={c.drawingMuted} fontSize={labelSize} textAnchor="middle" paintOrder="stroke fill" stroke={c.drawingPaper} strokeWidth={d.labelHalo}>
      <text x="280" y="44">6 000 mm · wall axes</text>
      <text transform="translate(27 225) rotate(-90)">4 000 mm</text>
    </g>
    <text x="70" y="405" fill={c.drawingInk} fontSize={labelSize}>{width < 450 ? 'Ground · units mm' : 'Ground floor · native fixture · units mm'}</text>
    <g stroke={c.drawingInk} strokeWidth={d.dimension}><path d="M70 427H210 M70 422V432 M140 422V432 M210 422V432" /></g>
    <text x="70" y="447" fill={c.drawingMuted} fontSize={labelSize}>0</text><text x="210" y="447" fill={c.drawingMuted} fontSize={labelSize} textAnchor="end">2 m</text>
  </svg>;
}

function Gallery() {
  const [selected, setSelected] = useState('T-24');
  const [draft, setDraft] = useState('Please check the clear opening at this door.');
  return <>
    <header className="gallery-header"><strong>BIM Forge</strong><span>Inside-first design system</span><a href="#controls">Skip to controls</a></header>
    <main className="gallery-main">
      <div className="gallery-intro"><h1>The model stays present.</h1><p>Shared presentation foundations from the approved spatial study. Fixture states below demonstrate appearance; they do not submit work or accept model changes.</p></div>
      <div className="gallery-workspace">
        <section className="gallery-plan" aria-label="Native fixture drafting specimen"><div className="gallery-section-heading"><h2>Ground floor</h2><span>Drawing specimen</span></div><NativeDrawing />
          <div className="gallery-line-legend"><span><i data-line="cut" />Cut 2.3</span><span><i data-line="outline" />Outline 1.3</span><span><i data-line="dimension" />Dimension 1</span><span><i data-line="existing" />Existing dashed</span></div>
        </section>
        <SpatialPanel title="Door clearance">
          <div className="gallery-conversation-meta"><TaskIdentity reference={selected} title="Ground-floor door" /><StateLabel tone="waiting">Needs input</StateLabel></div>
          <p className="gallery-message"><strong>You</strong>Check the opening without moving the wall.</p>
          <p className="gallery-message"><strong>Assistant</strong>The fixture door is 800 mm wide. What clear opening should the proposal achieve?</p>
          <WorkspaceNotice tone="stale" title="Source revision changed">Inspect the updated model before requesting a new proposal. The task remains at its original place.</WorkspaceNotice>
          <label className="gallery-field" htmlFor="gallery-draft">Follow-up message<textarea id="gallery-draft" value={draft} onChange={event => setDraft(event.target.value)} /></label>
          <Button disabled><ArrowRight aria-hidden="true" />Send unavailable in gallery</Button>
          <p className="gallery-caption">Single-engineer baseline. No audience or privacy selector.</p>
        </SpatialPanel>
      </div>
      <section id="controls" className="gallery-section" aria-labelledby="controls-heading"><h2 id="controls-heading">Controls and focus</h2>
        <p>Tab between actions. Focus remains visible; a selected task has a textual reference and an outline.</p>
        <div className="gallery-controls"><Button onClick={() => setSelected(selected === 'T-24' ? 'T-25' : 'T-24')}><MessageSquare aria-hidden="true" />Open next task</Button><Button variant="outline" onClick={() => setDraft('Please check the clear opening at this door.')}><ArrowLeft aria-hidden="true" />Reset draft</Button><Button variant="ghost" aria-label="Explain this gallery" onClick={() => document.getElementById('gallery-help')?.focus()}><CircleHelp aria-hidden="true" />Help</Button><Button disabled><Check aria-hidden="true" />Accept unavailable</Button></div>
        <p id="gallery-help" tabIndex={-1}>This is a local presentation gallery using a validated native model fixture. The live server remains the authority for all task and proposal decisions.</p>
      </section>
      <section className="gallery-section" aria-labelledby="tasks-heading"><h2 id="tasks-heading">Same place, separate tasks</h2><p>Task identity and status are readable in text, including when colors cannot be distinguished.</p>
        <div className="gallery-task-list">{['T-24', 'T-25'].map(reference => <Button key={reference} variant="outline" aria-pressed={selected === reference} onClick={() => setSelected(reference)}><TaskIdentity reference={reference} title={reference === 'T-24' ? 'Door clearance' : 'Door hardware'} /><span>{selected === reference ? 'Selected' : 'Open task'}</span></Button>)}</div>
      </section>
      <section className="gallery-section" aria-labelledby="states-heading"><h2 id="states-heading">Execution and review states</h2><p>Named examples of existing server states; a visible agent represents a conversation, not continuous execution.</p><dl className="gallery-states">{states.map(state => <div key={state.label}><dt><StateLabel tone={state.tone}>{state.label}</StateLabel></dt><dd>{state.detail}</dd></div>)}</dl></section>
      <section className="gallery-section gallery-notices" aria-label="Recovery and boundary states"><h2>Recovery and boundary states</h2><WorkspaceNotice title="No tasks here">Start a conversation from the model. Unplaced tasks remain discoverable in the task list.</WorkspaceNotice><WorkspaceNotice tone="active" title="Loading conversation">Retrieving saved messages. Your current draft stays available.</WorkspaceNotice><WorkspaceNotice tone="error" title="Conversation could not load">Reconnect and try opening this task again. Your draft is retained.</WorkspaceNotice></section>
    </main><footer className="gallery-footer">Approved Inside-first reference · draft #249 · presentation only · model delta 0</footer>
  </>;
}

const mount = document.getElementById('gallery');
if (!mount) throw new Error('Gallery mount is missing.');
createRoot(mount).render(<Gallery />);
