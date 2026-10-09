# ADRs to write (in your own words, after you build each piece)

1. Per-day availability buckets vs summing overlapping reservations
2. Mongo transactions vs Redis locks for reservations
3. Idempotency key storage: Mongo unique index vs Redis SET NX
4. Refresh token reuse detection: revoke the family (and the cost of a legitimate refresh race)
5. Socket.IO vs SSE for tracking; socket as a hint, REST as truth
6. Why location lives in Redis (latest) and Mongo (history)
7. Battery trade-offs in driver location streaming
8. In-memory vs Redis rate limit store
