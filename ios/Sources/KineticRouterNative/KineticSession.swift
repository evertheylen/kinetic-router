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
    private var bundleURL: URL
    private var isRecovering = false

    /// Entry id of the visit currently in flight (render requested, but
    /// renderCompleted/renderFailed not received yet). While set, incoming
    /// proposals are coalesced (dropped) — double-taps, taps mid-transition.
    private var visitInFlightEntryId: String?

    /// The modally presented entry, if any. Lives outside `entryStore` so the
    /// main stack keeps mirroring the navigation controller exactly.
    private(set) var modalEntry: KineticEntry?

    /// The entry whose content the webview is currently showing (snapshots
    /// must be stored on *this* entry — not necessarily the stack top, e.g.
    /// while a modal is presented).
    private var liveEntryId: String?

    public init(
        configuration: RouteConfiguration = RouteConfiguration(),
        bundleURL: URL
    ) {
        let wkConfig = WKWebViewConfiguration()
        wkConfig.allowsInlineMediaPlayback = true
        wkConfig.preferences.isElementFullscreenEnabled = true
        // UA marker for shell detection & server-side bundle selection.
        // (No KVC on private keys — this is the supported API.)
        wkConfig.applicationNameForUserAgent = "KineticNative/1.0; protocol \(PROTOCOL_VERSION)"

        webView = WKWebView(frame: .zero, configuration: wkConfig)
        webView.allowsBackForwardNavigationGestures = false
        webView.scrollView.contentInsetAdjustmentBehavior = .automatic

        self.configuration = configuration
        self.bundleURL = bundleURL
        bridge = Bridge(webView: webView)

        super.init()

        // self is fully initialized from here on; safe to capture
        bridge.onMessage = { [weak self] msg in
            Task { @MainActor [weak self] in
                await self?.handleMessage(msg)
            }
        }
        bridge.register()
        webView.navigationDelegate = self

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
            handleRenderCompleted(m)
        case .renderFailed(let m):
            handleRenderFailed(m)
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
            isReady = false
            let error = KineticError.protocolMismatch(
                jsVersion: msg.protocolVersion, swiftVersion: PROTOCOL_VERSION)
            print("[KineticRouterNative] \(error.localizedDescription)")
            delegate?.handshakeFailed(error)
            return
        }
        bundleVersion = msg.bundleVersion
        isReady = true
        visitInFlightEntryId = nil
        liveEntryId = nil

        if isRecovering, !entryStore.entries.isEmpty {
            // Process-death recovery: replay the full stack into the fresh JS
            // context (Swift owning the stack pays off here). The fresh
            // context's own initial entry id is discarded.
            isRecovering = false
            modalEntry = nil
            let entries = entryStore.entries.map {
                SetStackEntry(entryId: $0.id, url: $0.url, state: $0.state)
            }
            delegate?.restoreStack(entries: entryStore.entries, withWebView: webView)
            try? await bridge.setStack(entries)
        } else {
            // Fresh page load (cold start, or a dev-server reload): reset to a
            // single entry, adopting the id JS minted for it. The router
            // renders the initial page on its own — no render call needed.
            entryStore.removeAllEntries()
            modalEntry = nil
            let initialEntry = KineticEntry(id: msg.initialEntryId, url: msg.url)
            entryStore.append(initialEntry)
            liveEntryId = initialEntry.id

            delegate?.bridgeDidConnect(initialEntry: initialEntry, withWebView: webView)
        }
    }

    private func handleVisitProposed(_ msg: VisitProposedMessage) async {
        guard isReady, let delegate else { return }

        // Coalesce taps while a visit is in flight. JS rejects the stale
        // proposal automatically when the next (unrelated) render arrives.
        guard visitInFlightEntryId == nil else { return }

        let behaviour = resolveBehaviour(for: msg)

        switch behaviour {
        case .native(let factory):
            let vc = factory(msg.url, msg.state.flatMap { $0.dictionaryValue })
            delegate.pushNativeViewController(vc)
            // no render call: JS cleans the proposal up on the next render

        case .webPush:
            if msg.action == "replace" {
                await performWebReplace(msg, delegate: delegate)
            } else {
                await performWebPush(msg, delegate: delegate)
            }

        case .webModal:
            await performWebModal(msg, delegate: delegate)
        }
    }

    /// App-supplied tag override wins; otherwise the JS-declared presentation
    /// hint; otherwise a plain push.
    private func resolveBehaviour(for msg: VisitProposedMessage) -> RouteBehaviour {
        if let tag = msg.native?.tag, let override = configuration.override(for: tag) {
            return override
        }
        if msg.native?.presentation == "modal" {
            return .webModal
        }
        return .webPush
    }

    private func handleRenderCompleted(_ msg: RenderCompletedMessage) {
        if visitInFlightEntryId == msg.entryId {
            visitInFlightEntryId = nil
        }
        liveEntryId = msg.entryId
        if modalEntry?.id == msg.entryId {
            modalEntry?.title = msg.title
        } else {
            entryStore.updateTitle(msg.title, forId: msg.entryId)
        }
        delegate?.renderCompleted(entryId: msg.entryId, title: msg.title)
    }

    private func handleRenderFailed(_ msg: RenderFailedMessage) {
        if visitInFlightEntryId == msg.entryId {
            visitInFlightEntryId = nil
        }
        delegate?.renderFailed(entryId: msg.entryId, error: msg.error)
    }

    private func handleTitleChanged(_ msg: TitleChangedMessage) {
        if modalEntry?.id == msg.entryId {
            modalEntry?.title = msg.title
        } else {
            entryStore.updateTitle(msg.title, forId: msg.entryId)
        }
        delegate?.titleChanged(entryId: msg.entryId, title: msg.title)
    }

    private func handleStateUpdated(_ msg: StateUpdatedMessage) {
        if modalEntry?.id == msg.entryId {
            modalEntry?.state = msg.state
            if let url = msg.url { modalEntry?.url = url }
            return
        }
        entryStore.updateState(msg.state, forId: msg.entryId)
        if let url = msg.url {
            entryStore.updateUrl(url, forId: msg.entryId)
        }
    }

    private func handleExternalUrl(_ msg: ExternalUrlMessage) {
        guard let url = URL(string: msg.url) else { return }
        delegate?.openExternalUrl(url)
    }

    // ── Navigation choreography ──────────────────────────────────────

    /// Snapshot the current webview content (downscaled: full-resolution
    /// screenshots at 3× dominate memory use for no visible benefit during
    /// brief transitions).
    private func snapshotCurrent() async -> UIImage? {
        let config = WKSnapshotConfiguration()
        if webView.bounds.width > 0 {
            config.snapshotWidth = NSNumber(value: Double(webView.bounds.width) * 2)
        }
        do {
            return try await webView.takeSnapshot(configuration: config)
        } catch {
            print("[KineticRouterNative] snapshot failed: \(error)")
            return nil
        }
    }

    /// Snapshot the webview and store the image on the entry it is showing.
    private func freezeLiveEntry() async {
        guard let id = liveEntryId, let snapshot = await snapshotCurrent() else { return }
        if modalEntry?.id == id {
            modalEntry?.snapshot = snapshot
        } else {
            entryStore.setSnapshot(snapshot, forId: id)
        }
    }

    /// Frozen pixels for an entry, wherever it lives (stack or modal).
    func snapshot(forEntryId id: String) -> UIImage? {
        if modalEntry?.id == id { return modalEntry?.snapshot }
        return entryStore.entry(withId: id)?.snapshot
    }

    private func performWebPush(_ msg: VisitProposedMessage, delegate: KineticSessionDelegate) async {
        guard !entryStore.entries.isEmpty else { return }

        // 1. Freeze the current page: snapshot it, stored on its entry.
        await freezeLiveEntry()

        // 2. Mint entry id and create the new entry.
        let entry = KineticEntry(id: UUID().uuidString, url: msg.url, state: msg.state)
        entryStore.append(entry)
        visitInFlightEntryId = entry.id

        // 3. Push (snapshot over the old VC, placeholder over the new one;
        //    the webview moves along but stays covered until renderCompleted).
        delegate.pushEntry(entry, withWebView: webView, configuration: configuration)

        // 4. Tell JS to render.
        do {
            try await bridge.render(entryId: entry.id, url: msg.url, state: msg.state, proposalId: msg.proposalId)
        } catch {
            print("[KineticRouterNative] render call failed: \(error)")
            visitInFlightEntryId = nil
            delegate.renderFailed(entryId: entry.id, error: error.localizedDescription)
        }
    }

    private func performWebReplace(_ msg: VisitProposedMessage, delegate: KineticSessionDelegate) async {
        guard entryStore.count() > 0 else { return }

        // Freeze the outgoing page over the new VC while the replacement renders.
        let frozen = await snapshotCurrent()

        let entry = KineticEntry(id: UUID().uuidString, url: msg.url, state: msg.state)
        _ = entryStore.replace(at: entryStore.count() - 1, with: entry)
        visitInFlightEntryId = entry.id

        delegate.replaceTopEntry(entry, withWebView: webView, frozen: frozen)

        do {
            // JS disposes the replaced entry itself, *after* rendering
            // finished (so rendered subtrees can be reused) — no dispose here.
            try await bridge.render(entryId: entry.id, url: msg.url, state: msg.state, proposalId: msg.proposalId)
        } catch {
            print("[KineticRouterNative] replace render call failed: \(error)")
            visitInFlightEntryId = nil
            delegate.renderFailed(entryId: entry.id, error: error.localizedDescription)
        }
    }

    private func performWebModal(_ msg: VisitProposedMessage, delegate: KineticSessionDelegate) async {
        guard !entryStore.entries.isEmpty, modalEntry == nil else { return }

        // Freeze the page behind the sheet — it loses the webview.
        await freezeLiveEntry()

        let entry = KineticEntry(id: UUID().uuidString, url: msg.url, state: msg.state)
        modalEntry = entry
        visitInFlightEntryId = entry.id

        delegate.presentModalEntry(entry, withWebView: webView, configuration: configuration)

        do {
            try await bridge.render(entryId: entry.id, url: msg.url, state: msg.state, proposalId: msg.proposalId)
        } catch {
            print("[KineticRouterNative] modal render call failed: \(error)")
            visitInFlightEntryId = nil
            delegate.renderFailed(entryId: entry.id, error: error.localizedDescription)
        }
    }

    /// Called by the navigation controller when the modal was dismissed
    /// (interactively or programmatically). Returns the entry that should be
    /// restored at the top of the stack.
    func modalWasDismissed() -> KineticEntry? {
        if let modal = modalEntry {
            modalEntry = nil
            if visitInFlightEntryId == modal.id {
                visitInFlightEntryId = nil
            }
            Task { @MainActor [bridge] in
                try? await bridge.dispose(entryId: modal.id)
            }
        }
        return entryStore.last
    }

    // ── Cold start / deep links ──────────────────────────────────────

    /// Replace the whole stack (universal links). The delegate rebuilds the
    /// view controllers; JS renders the leaf.
    public func restoreStack(entries: [(entryId: String, url: String, state: SendableJSON?)]) async {
        guard isReady, let delegate else { return }

        entryStore.removeAllEntries()
        modalEntry = nil
        visitInFlightEntryId = nil
        liveEntryId = nil
        for e in entries {
            entryStore.append(KineticEntry(id: e.entryId, url: e.url, state: e.state))
        }

        delegate.restoreStack(entries: entryStore.entries, withWebView: webView)

        let setStackEntries = entries.map { SetStackEntry(entryId: $0.entryId, url: $0.url, state: $0.state) }
        try? await bridge.setStack(setStackEntries)
    }

    // ── Bundle loading / process-death recovery ──────────────────────

    private func loadBundle() {
        if bundleURL.isFileURL {
            webView.loadFileURL(bundleURL, allowingReadAccessTo: bundleURL.deletingLastPathComponent())
        } else {
            webView.load(URLRequest(url: bundleURL))
        }
    }

    func reloadBundle() {
        loadBundle()
    }

    // Note: no deinit needed. WebKit retains the Bridge (via the user content
    // controller), but the Bridge only references the session weakly and the
    // webview unowned — everything is released with the webview, which the
    // session owns.
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
