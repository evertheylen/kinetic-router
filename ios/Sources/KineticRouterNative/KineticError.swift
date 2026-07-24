import Foundation

enum KineticError: Error, LocalizedError {
    case unrecognizedMessage(String)
    case protocolMismatch(jsVersion: Int, swiftVersion: Int)
    case notReady
    case renderInProgress

    var errorDescription: String? {
        switch self {
        case .unrecognizedMessage(let msg): return "Unrecognized JS message: \(msg)"
        case .protocolMismatch(let js, let swift): return "Protocol version mismatch: JS=\(js), Swift=\(PROTOCOL_VERSION)"
        case .notReady: return "KineticSession is not ready"
        case .renderInProgress: return "A render is already in progress"
        }
    }
}
