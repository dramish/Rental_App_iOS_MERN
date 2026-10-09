/** WebSocket event contract. Every server->client event carries a monotonic `version`
 *  so clients can detect gaps and resync over REST. */
export interface ServerToClientEvents {
  'order.updated': (e: { orderId: string; status: string; version: number }) => void;
  'driver.location': (e: { orderId: string; lat: number; lng: number; recordedAt: string; seq: number }) => void;
}

export interface ClientToServerEvents {
  'subscribe.order': (orderId: string, ack: (ok: boolean) => void) => void;
  'unsubscribe.order': (orderId: string) => void;
}
