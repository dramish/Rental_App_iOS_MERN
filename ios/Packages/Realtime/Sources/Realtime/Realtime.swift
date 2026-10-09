import Foundation

/// TBI: the WebSocket layer. You've shipped this pattern at work; here the contract is:
///  - connect with the access token; reconnect with exponential backoff + jitter
///  - resubscribe to rooms on reconnect
///  - every server event carries `version`; on a gap or reconnect, resync over REST
///    (the socket is a hint, the server is the source of truth)
///  - tear down on background, reconnect on foreground
public enum ConnectionState: Sendable, Equatable {
    case disconnected, connecting, connected
}
