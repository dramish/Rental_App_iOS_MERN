# ADR 0003: Raw WebSocket as a hint, REST as the source of truth

- Status: accepted

## Context
Customers watch an order and a driver's position; drivers receive job offers.

## Decision
A small JSON protocol over a plain WebSocket (`ws` on the server, `URLSessionWebSocketTask` on iOS), with Redis pub/sub to fan out across API instances. Every order event carries a `version` and every location a `seq`. On reconnect, or when a version/seq gap is seen, the client refetches over REST (`GET /orders/:id`, `/orders/:id/tracking`, `/drivers/tasks`).

## Why not Socket.IO
Socket.IO needs its own client protocol; there is no first-party Swift client, and the features we need (rooms, acks, reconnect) are small. Owning the protocol keeps the iOS side dependency-free and the failure modes explicit.

## Consequences
- A missed WebSocket frame can never leave a client wrong for long: the next resync fixes it.
- Room subscriptions are authorized per room (order participants only).
- Heartbeat pings drop half-open connections.
