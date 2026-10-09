describe('order state machine', () => {
  it.todo('table-driven: every (state, event) pair, legal and illegal');
  it.todo('50 parallel transitions on one order: exactly one wins, version consistent');
  it.todo('replaying an idempotency key applies one transition and writes one audit row');
  it.todo('cancel under retry restores availability exactly once');
});
