import Foundation

let PROTOCOL_VERSION = 1

// ── JS → Swift messages ──────────────────────────────────────────────

enum JsMessageType: String, Codable {
    case ready
    case visitProposed
    case renderCompleted
    case renderFailed
    case titleChanged
    case stateUpdated
    case externalUrl
}

struct NativeStaticData: Codable, Sendable {
    struct Native: Codable, Sendable {
        let presentation: String?
        let tag: String?
    }
    let native: Native?
}

struct ReadyMessage: Codable, Sendable {
    let type: JsMessageType
    let protocolVersion: Int
    let bundleVersion: String?
    let url: String
}

struct VisitProposedMessage: Codable, Sendable {
    let type: JsMessageType
    let url: String
    let state: SendableJSON?
    let action: String // "push" | "replace"
    let routePattern: String?
    let native: NativeStaticData.Native?
}

struct RenderCompletedMessage: Codable, Sendable {
    let type: JsMessageType
    let entryId: String
    let title: String
}

struct RenderFailedMessage: Codable, Sendable {
    let type: JsMessageType
    let entryId: String
    let error: String
}

struct TitleChangedMessage: Codable, Sendable {
    let type: JsMessageType
    let entryId: String
    let title: String
}

struct StateUpdatedMessage: Codable, Sendable {
    let type: JsMessageType
    let entryId: String
    let state: SendableJSON?
}

struct ExternalUrlMessage: Codable, Sendable {
    let type: JsMessageType
    let url: String
}

// ── Discriminated union via wrapper decode ───────────────────────────

enum JsToSwiftMessage: Sendable {
    case ready(ReadyMessage)
    case visitProposed(VisitProposedMessage)
    case renderCompleted(RenderCompletedMessage)
    case renderFailed(RenderFailedMessage)
    case titleChanged(TitleChangedMessage)
    case stateUpdated(StateUpdatedMessage)
    case externalUrl(ExternalUrlMessage)
}

// ── Swift → JS commands ──────────────────────────────────────────────

struct SetStackEntry: Codable, Sendable {
    let entryId: String
    let url: String
    let state: SendableJSON?
}

// ── JSON wrapper that survives the Codable round-trip ─────────────────

/// Encodes as an opaque JSON value, decoded as `[String: SendableJSON]`.
/// Use to tunnel `state` payloads without knowing their structure.
enum SendableJSON: Codable, Sendable {
    case string(String)
    case number(Double)
    case integer(Int)
    case bool(Bool)
    case object([String: SendableJSON])
    case array([SendableJSON])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null; return }
        if let obj = try? container.decode([String: SendableJSON].self) { self = .object(obj); return }
        if let arr = try? container.decode([SendableJSON].self) { self = .array(arr); return }
        if let int = try? container.decode(Int.self) { self = .integer(int); return }
        if let dbl = try? container.decode(Double.self) { self = .number(dbl); return }
        if let bol = try? container.decode(Bool.self) { self = .bool(bol); return }
        let str = try container.decode(String.self)
        self = .string(str)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let v): try container.encode(v)
        case .number(let v): try container.encode(v)
        case .integer(let v): try container.encode(v)
        case .bool(let v): try container.encode(v)
        case .object(let v): try container.encode(v)
        case .array(let v): try container.encode(v)
        case .null: try container.encodeNil()
        }
    }
}

// ── Message decoding ─────────────────────────────────────────────────

/// Throws `KineticError` if the message type is unrecognized.
func decodeJsMessage(_ raw: [String: Any]) throws -> JsToSwiftMessage {
    let data = try JSONSerialization.data(withJSONObject: raw, options: [.fragmentsAllowed])
    let decoder = JSONDecoder()

    struct TypeOnly: Codable { let type: String }
    guard let envelope = try? decoder.decode(TypeOnly.self, from: data),
          let messageType = JsMessageType(rawValue: envelope.type) else {
        throw KineticError.unrecognizedMessage(String(describing: raw))
    }

    switch messageType {
    case .ready:
        return .ready(try decoder.decode(ReadyMessage.self, from: data))
    case .visitProposed:
        return .visitProposed(try decoder.decode(VisitProposedMessage.self, from: data))
    case .renderCompleted:
        return .renderCompleted(try decoder.decode(RenderCompletedMessage.self, from: data))
    case .renderFailed:
        return .renderFailed(try decoder.decode(RenderFailedMessage.self, from: data))
    case .titleChanged:
        return .titleChanged(try decoder.decode(TitleChangedMessage.self, from: data))
    case .stateUpdated:
        return .stateUpdated(try decoder.decode(StateUpdatedMessage.self, from: data))
    case .externalUrl:
        return .externalUrl(try decoder.decode(ExternalUrlMessage.self, from: data))
    }
}

/// Encode a Swift → JS command to a JSON string for evaluateJavaScript.
func encodeCommand(_ name: String, args: [Any]) -> String {
    let jsonArgs = args.map { arg -> String in
        if let str = arg as? String { return "\"\(str.replacingOccurrences(of: "\"", with: "\\\""))\"" }
        if let data = try? JSONSerialization.data(withJSONObject: arg, options: []),
           let json = String(data: data, encoding: .utf8) {
            return json
        }
        return "null"
    }
    return "window.__kineticNative.\(name)(\(jsonArgs.joined(separator: ", ")))"
}
