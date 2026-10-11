# ADR 0004: Rotating refresh tokens with reuse detection

- Status: accepted

## Decision
Short-lived JWT access tokens (15 min) plus opaque, hashed, single-use refresh tokens in a family. Using a token flips `usedAt` with a conditional update; presenting an already-used token revokes the whole family.

## Trade-offs
- A stolen refresh token is detected on the next use by either party.
- A legitimate client that refreshes twice concurrently looks like reuse and is logged out. The iOS client therefore serializes refresh (single in-flight task shared by concurrent requests).
- Sessions are revocable server-side, at the cost of a database read on refresh (not on every request).

## Sign in with Apple
Users are keyed by Apple's stable `sub`, never by email, and the token's `nonce` must equal SHA-256 of the raw nonce the client sent. Linking by email would allow account takeover through a relay address.
