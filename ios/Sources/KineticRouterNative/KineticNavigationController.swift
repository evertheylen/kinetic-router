import UIKit
import WebKit

/// `UINavigationController` subclass that owns the native navigation stack.
/// One instance per `KineticSession`.  Implements the push/pop choreography
/// with snapshotting so transitions are 100% native.
public final class KineticNavigationController: UINavigationController {
    unowned let session: KineticSession
    private var replacedViewControllers: [String: VisitableViewController] = [:]
    private let menuBar = UITabBar()
    private var menuBarHeightConstraint: NSLayoutConstraint!
    private var selectedMenuItem: MenuItem?

    init(session: KineticSession) {
        self.session = session
        super.init(nibName: nil, bundle: nil)
        delegate = self
        session.delegate = self
    }

    required init?(coder: NSCoder) { nil }

    // ── Lifecycle ────────────────────────────────────────────────────

    public override func viewDidLoad() {
        super.viewDidLoad()
        interactivePopGestureRecognizer?.delegate = self
        interactivePopGestureRecognizer?.isEnabled = true
        configureMenuBar()
    }

    public override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        // Include the home-indicator area in the glass surface, like a system
        // tab bar, rather than leaving a separate uncovered strip below it.
        menuBarHeightConstraint?.constant = 49 + view.safeAreaInsets.bottom
    }

    // ── Helpers ──────────────────────────────────────────────────────

    /// The navigation controller new pushes should target: the modal stack
    /// while a modal is presented, otherwise this one.
    private var activeNavigationController: UINavigationController {
        (presentedViewController as? UINavigationController) ?? self
    }

    /// Entry ids of every VisitableViewController currently alive (base
    /// stack + presented modal stack).
    private func allLiveEntryIds() -> Set<String> {
        var vcs = viewControllers
        if let modalNav = presentedViewController as? UINavigationController {
            vcs += modalNav.viewControllers
        }
        return Set(vcs.compactMap { ($0 as? VisitableViewController)?.entryId })
    }

    /// Removes (and disposes JS-side) entries whose view controllers are no
    /// longer part of any stack. Id-based, so native view controllers and
    /// modals never confuse it.
    private func disposeOrphanedEntries() {
        let liveIds = allLiveEntryIds()
        let removed = session.entryStore.removeEntries { !liveIds.contains($0.id) }
        guard !removed.isEmpty else { return }

        Task { @MainActor [session] in
            for entry in removed {
                try? await session.bridge.dispose(entryId: entry.id)
            }
        }
    }

    /// Freeze the given screen with its entry's snapshot before the webview
    /// leaves it (falls back to a placeholder if the snapshot was evicted).
    private func freeze(_ vc: VisitableViewController) {
        if let snapshot = session.snapshot(forEntryId: vc.entryId) {
            vc.show(snapshot: snapshot)
        } else {
            vc.showPlaceholder()
        }
    }

    private func visitableController(for entryId: String) -> VisitableViewController? {
        var vcs = viewControllers
        if let modalNav = presentedViewController as? UINavigationController {
            vcs += modalNav.viewControllers
        }
        return vcs
            .compactMap { $0 as? VisitableViewController }
            .first { $0.entryId == entryId }
    }

    private func configureMenuBar() {
        let home = UITabBarItem(
            title: "Home",
            image: UIImage(systemName: "house"),
            selectedImage: UIImage(systemName: "house.fill")
        )
        home.tag = MenuItem.home.rawValue
        let account = UITabBarItem(
            title: "Account",
            image: UIImage(systemName: "person.crop.circle"),
            selectedImage: UIImage(systemName: "person.crop.circle.fill")
        )
        account.tag = MenuItem.account.rawValue
        let agencies = UITabBarItem(
            title: "Agencies",
            image: UIImage(systemName: "building.2"),
            selectedImage: UIImage(systemName: "building.2.fill")
        )
        agencies.tag = MenuItem.agencies.rawValue

        menuBar.delegate = self
        menuBar.items = [home, account, agencies]
        menuBar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(menuBar)
        menuBarHeightConstraint = menuBar.heightAnchor.constraint(equalToConstant: 49)
        NSLayoutConstraint.activate([
            menuBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            menuBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            menuBar.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            menuBarHeightConstraint,
        ])
        updateSelectedMenuItem()
    }

    private enum MenuItem: Int {
        case home
        case account
        case agencies
    }

    private func menuItem(for url: String) -> MenuItem? {
        let path = URL(string: url)?.path ?? url
        if path == "/" || path == "/home" { return .home }
        if path.hasPrefix("/account") { return .account }
        if path.hasPrefix("/explore") { return .agencies }
        return nil
    }

    private func updateSelectedMenuItem(for url: String? = nil) {
        if let url {
            selectedMenuItem = menuItem(for: url)
        }
        guard let selectedMenuItem else { return }
        menuBar.selectedItem = menuBar.items?.first { $0.tag == selectedMenuItem.rawValue }
    }
}

// MARK: - KineticSessionDelegate

extension KineticNavigationController: KineticSessionDelegate {
    var entryStore: EntryStore { session.entryStore }

    func bridgeDidConnect(initialEntry: KineticEntry, withWebView webView: WKWebView) {
        // a dev-reload may leave a stale stack/modal behind
        if presentedViewController != nil {
            dismiss(animated: false)
        }

        let vc = VisitableViewController(entry: initialEntry)
        vc.attachWebView(webView)
        vc.reveal() // the page is already live; nothing to wait for
        setViewControllers([vc], animated: false)
        updateSelectedMenuItem(for: initialEntry.url)
    }

    func pushEntry(_ entry: KineticEntry, withWebView webView: WKWebView, configuration: RouteConfiguration) {
        let nav = activeNavigationController

        // freeze the outgoing screen: it keeps showing its page as pixels
        if let lastVC = nav.viewControllers.last as? VisitableViewController {
            freeze(lastVC)
        }

        // the new screen holds the webview but stays covered by a placeholder
        // until renderCompleted — otherwise the *old* page would be visible
        // sliding in during the push animation
        let vc = VisitableViewController(entry: entry)
        vc.showPlaceholder()
        vc.attachWebView(webView)
        nav.pushViewController(vc, animated: true)
    }

    func replaceTopEntry(_ entry: KineticEntry, withWebView webView: WKWebView, frozen: UIImage?) {
        let nav = activeNavigationController
        guard !nav.viewControllers.isEmpty else { return }

        if let previous = nav.viewControllers.last as? VisitableViewController {
            replacedViewControllers[entry.id] = previous
        }

        let vc = VisitableViewController(entry: entry)
        if let frozen {
            vc.show(snapshot: frozen) // outgoing page covers the swap
        } else {
            vc.showPlaceholder()
        }
        vc.attachWebView(webView)

        var stack = nav.viewControllers
        stack[stack.count - 1] = vc
        nav.setViewControllers(stack, animated: false)
    }

    func presentModalEntry(_ entry: KineticEntry, withWebView webView: WKWebView, configuration: RouteConfiguration) {
        // the screen behind the sheet was frozen by the session (snapshot)
        if let lastVC = viewControllers.last as? VisitableViewController {
            freeze(lastVC)
        }

        let vc = VisitableViewController(entry: entry)
        vc.showPlaceholder()
        vc.attachWebView(webView)

        let modalNav = UINavigationController(rootViewController: vc)
        modalNav.modalPresentationStyle = .pageSheet
        modalNav.delegate = self // didShow for pushes/pops inside the modal
        present(modalNav, animated: true) { [weak self, weak modalNav] in
            // UIKit creates the presentation controller during presentation.
            guard let self else { return }
            modalNav?.presentationController?.delegate = self
        }
    }

    func pushNativeViewController(_ viewController: UIViewController) {
        // The webview stays live on the previous screen (it is covered by the
        // native screen); no snapshot or entry bookkeeping is needed.
        activeNavigationController.pushViewController(viewController, animated: true)
    }

    func restoreStack(entries: [KineticEntry], withWebView webView: WKWebView) {
        if presentedViewController != nil {
            dismiss(animated: false)
        }

        var vcs: [UIViewController] = []
        for (i, entry) in entries.enumerated() {
            let vc = VisitableViewController(entry: entry)
            if let snapshot = entry.snapshot {
                vc.show(snapshot: snapshot)
            } else {
                vc.showPlaceholder()
            }
            if i == entries.count - 1 {
                // the leaf holds the webview; revealed on renderCompleted
                vc.attachWebView(webView)
            }
            vcs.append(vc)
        }
        setViewControllers(vcs, animated: false)
    }

    func renderCompleted(entryId: String, title: String) {
        replacedViewControllers.removeValue(forKey: entryId)
        guard let vc = visitableController(for: entryId) else { return }
        vc.reveal()
        vc.navigationItem.title = title
        updateSelectedMenuItem(for: vc.url)
    }

    func renderFailed(entryId: String, error: String, replacedEntry: KineticEntry?) {
        if let replacedEntry,
           let previousVC = replacedViewControllers.removeValue(forKey: entryId) {
            let nav = activeNavigationController
            guard !nav.viewControllers.isEmpty else { return }

            if let snapshot = replacedEntry.snapshot {
                previousVC.show(snapshot: snapshot)
            } else {
                previousVC.showPlaceholder()
            }
            previousVC.attachWebView(session.webView)

            var stack = nav.viewControllers
            stack[stack.count - 1] = previousVC
            nav.setViewControllers(stack, animated: false)

            Task { @MainActor [session] in
                try? await session.bridge.dispose(entryId: entryId)
                try? await session.bridge.render(
                    entryId: replacedEntry.id,
                    url: replacedEntry.url,
                    state: replacedEntry.state
                )
            }
            return
        }

        // failed modal: dismiss it and restore the webview to the stack top
        if let modalNav = presentedViewController as? UINavigationController,
           let modalRoot = modalNav.viewControllers.first as? VisitableViewController,
           modalRoot.entryId == entryId {
            dismiss(animated: true) { [weak self] in
                self?.handleModalDismissed()
            }
            return
        }

        let nav = activeNavigationController
        guard let topVC = nav.viewControllers.last as? VisitableViewController,
              topVC.entryId == entryId else { return }

        if nav.viewControllers.count > 1 {
            // didShow trims the store, disposes the failed entry, and
            // re-renders the revealed screen
            nav.popViewController(animated: false)
        } else {
            topVC.reveal()
        }
    }

    func titleChanged(entryId: String, title: String) {
        visitableController(for: entryId)?.navigationItem.title = title
    }
}

// MARK: - UINavigationControllerDelegate

extension KineticNavigationController: UINavigationControllerDelegate {
    public func navigationController(
        _ navigationController: UINavigationController,
        didShow viewController: UIViewController,
        animated: Bool
    ) {
        // Trim entries whose view controllers left the stack (pop committed;
        // also covers renderFailed unwinds). Cancelled interactive pops fire
        // didShow with the unchanged top — nothing gets trimmed then.
        disposeOrphanedEntries()

        guard let visitableVC = viewController as? VisitableViewController else {
            // revealed a native screen; the webview stays wherever it is
            return
        }

        // If the revealed screen already holds the webview this was a push
        // (or a cancelled pop) — nothing to restore.
        guard !visitableVC.holdsWebView(session.webView) else { return }

        // Pop committed: keep frozen pixels up, move the webview under them,
        // re-render (a RenderedRouteCache hit — effectively instant), and
        // reveal on renderCompleted.
        freeze(visitableVC)
        visitableVC.attachWebView(session.webView)

        let entry = session.entryStore.entry(withId: visitableVC.entryId)
        Task { @MainActor [session] in
            try? await session.bridge.render(
                entryId: visitableVC.entryId,
                url: entry?.url ?? visitableVC.url,
                state: entry?.state
            )
        }
    }
}

// MARK: - UITabBarDelegate

extension KineticNavigationController: UITabBarDelegate {
    public func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        let url: String
        switch MenuItem(rawValue: item.tag) {
        case .some(.home):
            url = "/home"
        case .some(.account):
            url = "/account"
        case .some(.agencies):
            url = "/explore"
        case nil:
            return
        }

        Task { @MainActor [session] in
            try? await session.visit(url: url)
        }
    }
}

// MARK: - UIGestureRecognizerDelegate

extension KineticNavigationController: UIGestureRecognizerDelegate {
    public func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard gestureRecognizer === interactivePopGestureRecognizer else { return true }
        return viewControllers.count > 1
    }
}

// MARK: - UIAdaptivePresentationControllerDelegate

extension KineticNavigationController: UIAdaptivePresentationControllerDelegate {
    public func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        handleModalDismissed()
    }

    /// Interactive or programmatic modal dismissal: dispose the modal entry
    /// (and anything pushed inside the modal), then restore the webview to
    /// the top of the base stack.
    private func handleModalDismissed() {
        _ = session.modalWasDismissed()
        disposeOrphanedEntries()

        guard let topVC = viewControllers.last as? VisitableViewController,
              let entry = session.entryStore.entry(withId: topVC.entryId) else { return }

        // frozen snapshot is still up from presentModalEntry
        freeze(topVC)
        topVC.attachWebView(session.webView)

        Task { @MainActor [session] in
            try? await session.bridge.render(entryId: entry.id, url: entry.url, state: entry.state)
        }
    }
}
