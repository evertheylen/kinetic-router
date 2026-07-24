import UIKit
import WebKit

/// The single-owner hub for the kinetic-router native shell.
///
/// Owns the shared `WKWebView`, the JS↔Swift bridge, the entry table, and
/// route configuration.  One `KineticSession` = one web session; for tabs
/// create multiple sessions (one webview + JS context per tab).
@MainActor
public final class KineticSession: NSObject {
    public let webView: WKWebView
    public let bridge: Bridge
    public let entryStore = EntryStore()
    public let configuration: RouteConfiguration

    weak var delegate: KineticSessionDelegate?

    private var isReady = false
    private var bundleVersion: String?
    private var bundleLoadRequest: URLRequest?
    private var bundleURL: URL
    private var isRecovering = false

    public init(
        configuration: RouteConfiguration = RouteConfiguration(),
        bundleURL: URL
    ) {
        let wkConfig = WKWebViewConfiguration()
        wkConfig.allowsInlineMediaPlayback = true
        wkConfig.preferences.isElementFullscreenEnabled = true

        webView = WKWebView(frame: .zero, configuration: wkConfig)
        webView.allowsBackForwardNavigationGestures = false
        webView.scrollView.contentInsetAdjustmentBehavior = .automatic

        self.configuration = configuration
        self.bundleURL = bundleURL
        bridge = Bridge(webView: webView) { [weak self] msg in
            Task { @MainActor [weak self] in
                await self?.handleMessage(msg)
            }
        }

        super.init()

        bridge.register()
        webView.navigationDelegate = self

        let ua = (WKWebView.value(forKey: "userAgent") as? String) ?? ""
        webView.customUserAgent = "\(ua) KineticNative/1.0; protocol \(PROTOCOL_VERSION)"

        loadBundle()
    }

    // ── Message handling ─────────────────────────────────────────────

    private func handleMessage(_ msg: JsToSwiftMessage) async {
        switch msg {
        case .ready(let m):
            await handleReady(m)
        case .visitProposed(let m):
            await handleVisitProposed(m)
        case .renderCompleted(let m):
            delegate?.renderCompleted(entryId: m.entryId, title: m.title)
        case .renderFailed(let m):
            delegate?.renderFailed(entryId: m.entryId, error: m.error)
        case .titleChanged(let m):
            handleTitleChanged(m)
        case .stateUpdated(let m):
            handleStateUpdated(m)
        case .externalUrl(let m):
            handleExternalUrl(m)
        }
    }

    private func handleReady(_ msg: ReadyMessage) async {
        guard msg.protocolVersion == PROTOCOL_VERSION else {
            print("[KineticRouterNative] Protocol mismatch: JS=\(msg.protocolVersion), Swift=\(PROTOCOL_VERSION)")
            return
        }
        bundleVersion = msg.bundleVersion
        isReady = true

        if isRecovering, !entryStore.entries.isEmpty {
            // Process-death recovery: replay the full stack.
            isRecovering = false
            let entries = entryStore.entries.map {
                SetStackEntry(entryId: $0.id, url: $0.url, state: $0.state)
            }
            try? await bridge.setStack(entries)
            if let delegate {
                delegate.restoreStack(entries: entryStore.entries, withWebView: webView)
            }
        } else {
            let initialEntry = KineticEntry(id: UUID().uuidString, url: msg.url)
            entryStore.append(initialEntry)

            if let delegate {
                delegate.bridgeDidConnect(initialEntry: initialEntry, withWebView: webView)
            }
        }
    }

    private func handleVisitProposed(_ msg: VisitProposedMessage) async {
        guard isReady, let delegate else { return }

        let tag = msg.native?.tag
        let behaviour = tag.map { configuration.behaviour(for: $0) } ?? .webPush

        switch behaviour {
        case .native(let factory):
            let vc = factory(msg.url, msg.state.flatMap { $0.dictionaryValue })
            pushNativeViewController(vc)

        case .webPush:
            if msg.action == "replace" {
                await performWebReplace(url: msg.url, state: msg.state, delegate: delegate)
            } else {
                await performWebPush(url: msg.url, state: msg.state, delegate: delegate)
            }

        case .webModal:
            performWebModal(url: msg.url, state: msg.state, delegate: delegate)
        }
    }

    private func handleTitleChanged(_ msg: TitleChangedMessage) {
        guard let idx = entryStore.entries.firstIndex(where: { $0.id == msg.entryId }) else {
            return
        }
        entryStore.entries[idx].title = msg.title
    }

    private func handleStateUpdated(_ msg: StateUpdatedMessage) {
        guard let idx = entryStore.entries.firstIndex(where: { $0.id == msg.entryId }) else {
            return
        }
        entryStore.entries[idx].state = msg.state
    }

    private func handleExternalUrl(_ msg: ExternalUrlMessage) {
        guard let url = URL(string: msg.url) else { return }
        delegate?.openExternalUrl(url)
    }

    // ── Navigation choreography ──────────────────────────────────────

    /// Snapshot the current webview content and assign it to the current entry.
    private func snapshotCurrent() async -> UIImage? {
        do {
            return try await webView.takeSnapshot(configuration: nil)
        } catch {
            print("[KineticRouterNative] snapshot failed: \(error)")
            return nil
        }
    }

    private func performWebPush(url: String, state: SendableJSON?, delegate: KineticSessionDelegate) async {
        guard !entryStore.entries.isEmpty else { return }

        // 1. Snapshot the current webview.
        let snapshot = await snapshotCurrent()

        if let lastIdx = entryStore.entries.indices.last {
            entryStore.entries[lastIdx].snapshot = snapshot
        }

        // 2. Mint entry id and create new entry.
        let entryId = UUID().uuidString
        let entry = KineticEntry(id: entryId, url: url, state: state)

        // 3. Create and configure the new VisitableViewController, move webview.
        entryStore.append(entry)

        // 4. Tell JS to render.
        // 5. Push the new VC.
        delegate.pushEntry(entry, withWebView: webView, configuration: configuration)

        do {
            try await bridge.render(entryId: entryId, url: url, state: state)
        } catch {
            print("[KineticRouterNative] render call failed: \(error)")
            delegate.renderFailed(entryId: entryId, error: error.localizedDescription)
        }
    }

    private func performWebReplace(url: String, state: SendableJSON?, delegate: KineticSessionDelegate) async {
        guard !entryStore.entries.isEmpty else { return }

        // Replace does not trigger a VC transition, so we only update the history stack
        // and render the new content in place.
        let entryId = UUID().uuidString
        let entry = KineticEntry(id: entryId, url: url, state: state)

        let replacedEntry = entryStore.replace(at: entryStore.count() - 1, with: entry)

        delegate.replaceTopEntry(entry, withWebView: webView)

        do {
            try await bridge.render(entryId: entryId, url: url, state: state)
            if let oldId = replacedEntry?.id {
                try? await bridge.dispose(entryId: oldId)
            }
        } catch {
            print("[KineticRouterNative] replace render call failed: \(error)")
            delegate.renderFailed(entryId: entryId, error: error.localizedDescription)
        }
    }

    private func performWebModal(url: String, state: SendableJSON?, delegate: KineticSessionDelegate) {
        guard !entryStore.entries.isEmpty else { return }

        let entryId = UUID().uuidString
        let entry = KineticEntry(id: entryId, url: url, state: state)
        entryStore.append(entry)

        delegate.presentModalEntry(entry, withWebView: webView, configuration: configuration)

        Task {
            try? await bridge.render(entryId: entryId, url: url, state: state ?? .null)
        }
    }

    private func pushNativeViewController(_ vc: UIViewController) {
        guard let delegate else { return }
        delegate.pushNativeViewController(vc)
    }

    // ── Cold start / deep links ──────────────────────────────────────

    func restoreStack(entries: [(entryId: String, url: String, state: SendableJSON?)]) async {
        guard isReady, let delegate else { return }

        entryStore.entries.removeAll()
        for e in entries {
            entryStore.append(KineticEntry(id: e.entryId, url: e.url, state: e.state))
        }

        // Push all intermediate entries without animation.
        // Then render the leaf by calling setStack on JS.
        let setStackEntries = entries.map { SetStackEntry(entryId: $0.entryId, url: $0.url, state: $0.state) }
        try? await bridge.setStack(setStackEntries)
    }

    // ── Webview process-death recovery ───────────────────────────────

    private func loadBundle() {
        if bundleURL.isFileURL {
            bundleLoadRequest = URLRequest(url: bundleURL)
            webView.loadFileURL(bundleURL, allowingReadAccessTo: bundleURL.deletingLastPathComponent())
        } else {
            bundleLoadRequest = URLRequest(url: bundleURL)
            webView.load(bundleLoadRequest!)
        }
    }

    func reloadBundle() {
        loadBundle()
    }

    deinit {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "kineticRouter")
    }
}

// MARK: - WKNavigationDelegate

extension KineticSession: WKNavigationDelegate {
    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        print("[KineticRouterNative] web process terminated — reloading bundle for recovery")
        isReady = false
        isRecovering = true
        loadBundle()
    }
}

// MARK: - SendableJSON helpers

extension SendableJSON {
    var dictionaryValue: [String: Any]? {
        guard case .object(let dict) = self else { return nil }
        return dict.reduce(into: [:]) { $0[$1.key] = $1.value.anyValue }
    }

    var anyValue: Any {
        switch self {
        case .string(let v): return v
        case .number(let v): return v
        case .integer(let v): return v
        case .bool(let v): return v
        case .object(let v): return v.mapValues { $0.anyValue }
        case .array(let v): return v.map { $0.anyValue }
        case .null: return NSNull()
        }
    }
}
