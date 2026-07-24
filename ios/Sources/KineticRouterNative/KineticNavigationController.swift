import UIKit
import WebKit

/// `UINavigationController` subclass that owns the native navigation stack.
/// One instance per `KineticSession`.  Implements the push/pop choreography
/// with snapshotting so transitions are 100% native.
final class KineticNavigationController: UINavigationController {
    unowned let session: KineticSession

    init(session: KineticSession) {
        self.session = session
        super.init(nibName: nil, bundle: nil)
        delegate = self
        session.delegate = self
    }

    required init?(coder: NSCoder) { nil }

    // ── Lifecycle ────────────────────────────────────────────────────

    override func viewDidLoad() {
        super.viewDidLoad()
        // Keep the default interactive pop gesture enabled.
        interactivePopGestureRecognizer?.isEnabled = true
    }
}

// MARK: - KineticSessionDelegate

extension KineticNavigationController: KineticSessionDelegate {
    var entryStore: EntryStore { session.entryStore }

    func bridgeDidConnect(initialEntry: KineticEntry, withWebView webView: WKWebView) {
        let vc = VisitableViewController(entry: initialEntry)
        vc.showWebView(webView)
        setViewControllers([vc], animated: false)
    }

    func pushEntry(_ entry: KineticEntry, withWebView webView: WKWebView, configuration: RouteConfiguration) {
        if let lastVC = viewControllers.last as? VisitableViewController,
           let lastEntry = session.entryStore.entries.first(where: { $0.id == lastVC.entryId }) {
            lastVC.show(snapshot: lastEntry.snapshot)
        }

        let vc = VisitableViewController(entry: entry)
        vc.showPlaceholder()
        vc.showWebView(webView)
        pushViewController(vc, animated: true)
    }

    func replaceTopEntry(_ entry: KineticEntry, withWebView webView: WKWebView) {
        guard !viewControllers.isEmpty else { return }

        let vc = VisitableViewController(entry: entry)
        vc.showWebView(webView)

        var stack = viewControllers
        stack[stack.count - 1] = vc
        setViewControllers(stack, animated: false)
    }

    func presentModalEntry(_ entry: KineticEntry, withWebView webView: WKWebView, configuration: RouteConfiguration) {
        if let lastVC = viewControllers.last as? VisitableViewController,
           let lastEntry = session.entryStore.entries.first(where: { $0.id == lastVC.entryId }) {
            lastVC.show(snapshot: lastEntry.snapshot)
        }

        let vc = VisitableViewController(entry: entry)
        vc.showPlaceholder()
        vc.showWebView(webView)

        let modalNav = UINavigationController(rootViewController: vc)
        modalNav.modalPresentationStyle = .pageSheet
        present(modalNav, animated: true)
    }

    func renderCompleted(entryId: String, title: String) {
        if let idx = session.entryStore.entries.firstIndex(where: { $0.id == entryId }) {
            session.entryStore.entries[idx].title = title
        }

        for vc in viewControllers {
            guard let visitable = vc as? VisitableViewController,
                  visitable.entryId == entryId else { continue }
            visitable.removeSnapshot()
            visitable.navigationItem.title = title
        }
    }

    func renderFailed(entryId: String, error: String) {
        guard let topVC = viewControllers.last as? VisitableViewController,
              topVC.entryId == entryId else { return }

        if viewControllers.count > 1 {
            popViewController(animated: false)
        }
    }

    func pushNativeViewController(_ viewController: UIViewController) {
        if let lastVC = viewControllers.last as? VisitableViewController,
           let lastEntry = session.entryStore.entries.first(where: { $0.id == lastVC.entryId }) {
            lastVC.show(snapshot: lastEntry.snapshot)
        }
        pushViewController(viewController, animated: true)
        let entryId = UUID().uuidString
        let nativeEntry = KineticEntry(id: entryId, url: "")
        session.entryStore.append(nativeEntry)
    }

    func restoreStack(entries: [KineticEntry], withWebView webView: WKWebView) {
        var vcs: [UIViewController] = []
        for entry in entries {
            let vc = VisitableViewController(entry: entry)
            vc.showPlaceholder()
            vcs.append(vc)
        }
        // The leaf VC gets the live webview.
        if let leafVC = vcs.last {
            leafVC.showWebView(webView)
        }
        setViewControllers(vcs, animated: false)
    }
}

// MARK: - UINavigationControllerDelegate

extension KineticNavigationController: UINavigationControllerDelegate {
    func navigationController(
        _ navigationController: UINavigationController,
        didShow viewController: UIViewController,
        animated: Bool
    ) {
        guard let visitableVC = viewController as? VisitableViewController else { return }

        // Check if we went back (pop committed).
        let currentCount = viewControllers.count
        let storeCount = session.entryStore.count()

        if currentCount < storeCount {
            // Pop committed: move webview to the revealed VC + re-render.
            handlePopCommitted(revealedVC: visitableVC)
        }
    }

    private func handlePopCommitted(revealedVC: VisitableViewController) {
        let newCount = viewControllers.count
        let storeCount = session.entryStore.count()

        // Dispose entries that were popped (trim store to match VC count).
        while session.entryStore.count() > newCount {
            guard let removed = session.entryStore.removeLast() else { break }
            Task { @MainActor [session] in
                try? await session.bridge.dispose(entryId: removed.id)
            }
        }

        // Move webview from whatever held it to the revealed VC.
        // If a snapshot exists on the revealed entry, show it first.
        let entryId = revealedVC.entryId

        if let snapshot = session.entryStore.entries.first(where: { $0.id == entryId })?.snapshot {
            revealedVC.show(snapshot: snapshot)
        }

        revealedVC.showWebView(session.webView)

        // Call render — cache hit, so effectively instant.
        let entry = session.entryStore.entries.first { $0.id == entryId }
        Task { @MainActor [session] in
            try? await session.bridge.render(
                entryId: entryId,
                url: entry?.url ?? revealedVC.url,
                state: entry?.state
            )
        }
    }
}
