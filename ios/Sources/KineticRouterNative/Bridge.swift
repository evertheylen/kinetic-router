import WebKit

/// Sends JS messages to Swift and dispatches Swift commands to JS.
/// Wraps `WKScriptMessageHandler` — the bridge is registered as
/// `window.webkit.messageHandlers.kineticRouter` on the webview.
///
/// Ownership: the `WKUserContentController` retains the bridge, which is fine
/// because the bridge only holds the session weakly (via `onMessage`) and the
/// webview unowned; everything is released when the webview goes away.
@MainActor
public final class Bridge: NSObject, WKScriptMessageHandler {
    private unowned let webView: WKWebView

    /// Assigned by the session right after construction (it cannot be an init
    /// parameter: the closure captures the session, which is not fully
    /// initialized while its `bridge` property is being assigned).
    var onMessage: ((JsToSwiftMessage) -> Void)?

    init(webView: WKWebView) {
        self.webView = webView
        super.init()
    }

    func register() {
        webView.configuration.userContentController.add(self, name: "kineticRouter")
    }

    // ── Incoming (JS → Swift) ────────────────────────────────────────

    public func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard let body = message.body as? [String: Any] else { return }
        do {
            let msg = try decodeJsMessage(body)
            onMessage?(msg)
        } catch {
            print("[KineticRouterNative] failed to decode message: \(error)")
        }
    }

    // ── Outgoing (Swift → JS) ────────────────────────────────────────

    func render(entryId: String, url: String, state: SendableJSON?, proposalId: String? = nil) async throws {
        var args = [jsonLiteral(entryId), jsonLiteral(url), jsonLiteral(state)]
        if let proposalId {
            args.append(jsonLiteral(proposalId))
        }
        try await evaluate(command: "render", args: args)
    }

    func dispose(entryId: String) async throws {
        try await evaluate(command: "dispose", args: [jsonLiteral(entryId)])
    }

    func setStack(_ entries: [SetStackEntry]) async throws {
        try await evaluate(command: "setStack", args: [jsonLiteral(entries)])
    }

    // ── Helpers ──────────────────────────────────────────────────────

    /// `void` so the script's result is always `undefined`: WKWebView's
    /// `evaluateJavaScript` fails with `WKErrorJavaScriptResultTypeIsUnsupported`
    /// when the result is not serializable (e.g. a Promise).
    private func evaluate(command: String, args: [String]) async throws {
        let script = "void window.__kineticNative.\(command)(\(args.joined(separator: ", ")))"
        try await webView.evaluateJavaScriptDiscardingResult(script)
    }

    /// Serializes any Encodable value (including bare strings) to a JSON
    /// literal that is safe to splice into a script — proper escaping of
    /// quotes, backslashes, newlines, and U+2028/U+2029.
    private func jsonLiteral<T: Encodable>(_ value: T?) -> String {
        guard let value,
              let data = try? JSONEncoder().encode(value),
              let str = String(data: data, encoding: .utf8) else {
            return "null"
        }
        return str
    }
}

// ── Async evaluateJavaScript helper ──────────────────────────────────

extension WKWebView {
    /// Result-discarding variant: the built-in async `evaluateJavaScript`
    /// returns `Any?`, which is not `Sendable` and trips strict concurrency
    /// when resumed through a continuation. Our bridge commands never produce
    /// a result, so drop it inside the completion handler.
    @MainActor
    func evaluateJavaScriptDiscardingResult(_ script: String) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            evaluateJavaScript(script) { _, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
        }
    }
}
