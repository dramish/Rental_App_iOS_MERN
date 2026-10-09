/**
 * TBI these. They are the proof that goes in the README.
 */
describe('availability', () => {
  it.todo('100 parallel reservations for the last N units: exactly N succeed, no day over capacity');
  it.todo('multi-item cart is atomic: failure on one SKU leaves every counter untouched');
  it.todo('release() twice decrements once');
  it.todo('hold expiry racing a payment webhook never double-releases or releases a confirmed reservation');
  it.todo('overlap matrix: adjacent, nested, partial, and buffer-day overlaps');
  it.todo('same idempotencyKey returns the original reservations and increments once');
});
