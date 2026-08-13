// Is a lead's stage a "closed" one?
//
// Used to decide whether a prior lead from the same source should still block a
// new one. A customer who was a lead months ago and comes back about a NEW job
// is a second lead, not a duplicate — but a lead that's still being worked
// probably is.
//
// ⚠ This is a HINT, not a guarantee. `tracker_stages` is admin-editable per
// company and its `system_role` column is unused (null on every row today), so a
// tenant could name its closed stages anything. That's deliberate: every caller
// pairs this with an explicit "add another anyway" escape hatch, so a wrong
// answer costs one extra click and can never leave someone unable to add a lead.
//
// Heroes today: closed_won (407) · closed_lost (148) · closed_other (106) —
// 661 of 770 leads, so the common returning-customer case needs no extra click.
export function leadStageIsClosed(stage: string | null | undefined): boolean {
  return typeof stage === 'string' && stage.trim().toLowerCase().startsWith('closed')
}
