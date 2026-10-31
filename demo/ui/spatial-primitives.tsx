import type { ComponentProps, ReactNode } from 'react';
import { cn } from './utils.ts';

/** Presentation only: callers derive this label from the real task/execution projection. */
export type TaskTone = 'neutral' | 'active' | 'waiting' | 'error' | 'ready' | 'settled' | 'stale';

export function TaskIdentity({ reference, title }: { reference: string; title: string }) {
  return <span className="spatial-task-identity"><strong>{reference}</strong><span>{title}</span></span>;
}

export function StateLabel({ tone = 'neutral', children }: { tone?: TaskTone; children: ReactNode }) {
  return <span className="spatial-state-label" data-tone={tone}>{children}</span>;
}

export function SpatialPanel({ title, children, className, ...props }: ComponentProps<'section'> & { title: string }) {
  return <section aria-label={title} className={cn('spatial-panel', className)} {...props}>
    <h2>{title}</h2>{children}
  </section>;
}

export function WorkspaceNotice({ tone = 'neutral', title, children }: {
  tone?: TaskTone; title: string; children: ReactNode;
}) {
  return <div className="spatial-notice" data-tone={tone}>
    <strong>{title}</strong><p>{children}</p>
  </div>;
}
