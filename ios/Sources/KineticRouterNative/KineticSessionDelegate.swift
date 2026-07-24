import WebKit
import SafariServices

import UIKit
import SafariServices

/// Delegate that KineticSession calls to perform navigation actions.
/// Implemented by KineticNavigationController.
@MainActor
protocol KineticSessionDelegate: AnyObject {
    var entryStore: EntryStore { get }

    /// Called when the bridge handshake completes and the initial entry is
    /// known.  The delegate should set up the root VisitableViewController.
    func bridgeDidConnect(initialEntry: KineticEntry, withWebView webView: WKWebView)

    /// Push a new VisitableViewController with the given entry and webview.
    func pushEntry(_ entry: KineticEntry, withWebView webView: WKWebView, configuration: RouteConfiguration)

    /// Replace the top entry (used by replace navigations).
    func replaceTopEntry(_ entry: KineticEntry, withWebView webView: WKWebView)

    /// Present a modal stack with the webview.
    func presentModalEntry(_ entry: KineticEntry, withWebView webView: WKWebView, configuration: RouteConfiguration)

    /// Push a fully native UIViewController (e.g. native settings form).
    func pushNativeViewController(_ viewController: UIViewController)

    /// Called after process-death recovery with the preserved entry list.
    /// The delegate should rebuild the view controller stack and restore
    /// the webview to the leaf entry.
    func restoreStack(entries: [KineticEntry], withWebView webView: WKWebView)

    /// Open an external URL (off-sitemap link). Default implementation opens
    /// in `SFSafariViewController`.
    func openExternalUrl(_ url: URL)

    /// Call when a render completed — reveal the live content.
    func renderCompleted(entryId: String, title: String)

    /// Call when a render failed — show error.
    func renderFailed(entryId: String, error: String)
}

extension KineticSessionDelegate {
    func openExternalUrl(_ url: URL) {
        guard let rootVC = UIApplication.shared.connectedScenes
            .compactMap({ ($0 as? UIWindowScene)?.keyWindow?.rootViewController })
            .first else { return }
        let safariVC = SFSafariViewController(url: url)
        rootVC.present(safariVC, animated: true)
    }
}
