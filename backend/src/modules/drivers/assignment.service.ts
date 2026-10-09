import { notImplemented } from '../../utils/errors';

/**
 * TBI (piece #4).
 *  - findCandidates(order): $near query on driver last-known location + availability filter.
 *  - claimOrder(orderId, driverId): atomic conditional update so two drivers cannot claim one order.
 *  - Offer timeout -> BullMQ delayed job -> reassign to next candidate.
 */
export async function claimOrder(_orderId: string, _driverId: string): Promise<boolean> {
  throw notImplemented('claimOrder()');
}
