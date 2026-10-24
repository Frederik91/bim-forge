export type PageName = 'request' | 'review' | 'history';
export type ReviewDecision = 'accepted' | 'revision-requested';

export function pageAfterReviewDecision(decision: ReviewDecision): PageName {
  return decision === 'accepted' ? 'history' : 'request';
}
