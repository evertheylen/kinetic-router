import WebKit

/// Sends JS messages to Swift and dispatches Swift commands to JS.
/// Wraps `WKScriptMessageHandler` — the bridge is registered as
/// `window.webkit.messageHandlers.kineticRouter` on the webview.
@MainActor
final class Bridge: NSObject, WKScriptMessageHandler {
    private unowned let webView: WKWebView
    private let onMessage: (JsToSwiftMessage) -> Void

    init(webView: WKWebView, onMessage: @escaping (JsToSwiftMessage) -> Void) {
        self.webView = webView
        self.onMessage = onMessage
        super.init()
    }

    func register() {
        webView.configuration.userContentController.add(self, name: "kineticRouter")
    }

    // ── Incoming (JS → Swift) ────────────────────────────────────────

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard let body = message.body as? [String: Any] else { return }
        do {
            let msg = try decodeJsMessage(body)
            onMessage(msg)
        } catch {
            print("[KineticRouterNative] failed to decode message: \(error)")
        }
    }

    // ── Outgoing (Swift → JS) ────────────────────────────────────────

    func render(entryId: String, url: String, state: SendableJSON?) async throws {
        let json: String
        if let state, let data = try? JSONEncoder().encode(state),
           let str = String(data: data, encoding: .utf8) {
            json = str
        } else {
            json = "null"
        }
        let entryIdJson = (try? String(data: JSONEncoder().encode(entryId), encoding: .utf8)) ?? "\"\""
        let urlJson = (try? String(data: JSONEncoder().encode(url), encoding: .utf8)) ?? "\"\""
        let script = "window.__kineticNative.render(\(entryIdJson), \(urlJson), \(json))"
        try await webView.evaluateJavaScript(script)
    }

    func dispose(entryId: String) async throws {
        let entryIdJson = (try? String(data: JSONEncoder().encode(entryId), encoding: .utf8)) ?? "\"\""
        let script = "window.__kineticNative.dispose(\(entryIdJson))"
        try await webView.evaluateJavaScript(script)
    }

    func setStack(_ entries: [SetStackEntry]) async throws {
        guard let jsonData = try? JSONEncoder().encode(entries),
              let jsonStr = String(data: jsonData, encoding: .utf8) else { return }
        let script = "window.__kineticNative.setStack(\(jsonStr))"
        try await webView.evaluateJavaScript(script)
    }
}

// ── Async evaluateJavaScript helper ──────────────────────────────────

extension WKWebView {
    @MainActor
    @discardableResult
    func evaluateJavaScript(_ script: String) async throws -> Any? {
        try await withCheckedThrowingContinuation { continuation in
            evaluateJavaScript(script) { result, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: result)
                }
            }
        }
    }
}
