import UIKit
import WebKit
import SafariServices

/// Delegate that KineticSession calls to perform navigation actions.
/// Implemented by KineticNavigationController.
@MainActor
protocol KineticSessionDelegate: AnyObject {
    var entryStore: EntryStore { get }

    /// Called when the bridge handshake completes and the initial entry is
    /// known.  The delegate should set up the root VisitableViewController;
    /// the page is already rendered (the router renders it on its own).
    func bridgeDidConnect(initialEntry: KineticEntry, withWebView webView: WKWebView)

    /// Push a new VisitableViewController with the given entry and webview.
    /// The new screen stays covered (placeholder) until `renderCompleted`.
    func pushEntry(_ entry: KineticEntry, withWebView webView: WKWebView, configuration: RouteConfiguration)

    /// Replace the top entry (used by replace navigations). `frozen` is a
    /// snapshot of the outgoing page to cover the swap until `renderCompleted`.
    func replaceTopEntry(_ entry: KineticEntry, withWebView webView: WKWebView, frozen: UIImage?)

    /// Present a modal stack with the webview.
    func presentModalEntry(_ entry: KineticEntry, withWebView webView: WKWebView, configuration: RouteConfiguration)

    /// Push a fully native UIViewController (e.g. native settings form).
    /// The webview stays (live) on the previous screen.
    func pushNativeViewController(_ viewController: UIViewController)

    /// Called for deep links and after process-death recovery with the
    /// (re)constructed entry list. The delegate should rebuild the view
    /// controller stack; the leaf holds the webview, covered until
    /// `renderCompleted`.
    func restoreStack(entries: [KineticEntry], withWebView webView: WKWebView)

    /// Open an external URL (off-sitemap link). Default implementation opens
    /// in `SFSafariViewController`.
    func openExternalUrl(_ url: URL)

    /// A render completed — reveal the live content for this entry.
    func renderCompleted(entryId: String, title: String)

    /// A render failed — unwind and surface the error.
    func renderFailed(entryId: String, error: String)

    /// The leaf page's title changed reactively (drives the nav bar).
    func titleChanged(entryId: String, title: String)

    /// The bridge handshake failed (protocol mismatch). The app should
    /// surface this loudly — the webview will not respond to navigation.
    func handshakeFailed(_ error: KineticError)
}

extension KineticSessionDelegate {
    func openExternalUrl(_ url: URL) {
        guard let rootVC = UIApplication.shared.connectedScenes
            .compactMap({ ($0 as? UIWindowScene)?.keyWindow?.rootViewController })
            .first else { return }
        let safariVC = SFSafariViewController(url: url)
        rootVC.present(safariVC, animated: true)
    }

    func handshakeFailed(_ error: KineticError) {
        assertionFailure("[KineticRouterNative] handshake failed: \(error.localizedDescription)")
    }
}
