import { notImplemented } from '../../utils/errors';

/**
 * TBI (piece #5).
 *  - ingest(driverId, point): validate, drop out-of-order (by client timestamp/seq), throttle,
 *    write latest to Redis, append history to Mongo, fan out to the order room.
 *  - Document what happens when a driver goes offline and replays a buffered batch.
 */
export interface LocationPoint {
  lat: number;
  lng: number;
  accuracy: number;
  speed?: number;
  recordedAt: Date;
  seq: number;
}

export async function ingest(_driverId: string, _point: LocationPoint): Promise<void> {
  throw notImplemented('location ingest');
}
