import Foundation

public enum KineticError: Error, LocalizedError, Sendable {
    case unrecognizedMessage(String)
    case protocolMismatch(jsVersion: Int, swiftVersion: Int)
    case notReady
    case renderInProgress

    public var errorDescription: String? {
        switch self {
        case .unrecognizedMessage(let msg):
            return "Unrecognized JS message: \(msg)"
        case .protocolMismatch(let js, let swift):
            return "Protocol version mismatch: JS=\(js), Swift=\(swift)"
        case .notReady:
            return "KineticSession is not ready"
        case .renderInProgress:
            return "A render is already in progress"
        }
    }
}
