import UIKit
import WebKit

/// One per navigation entry.  Holds the live `WKWebView` slot (only one entry
/// at a time holds the webview) plus an overlay — a frozen snapshot or a
/// placeholder — that covers the webview until its content matches this entry.
///
/// The overlay and the webview are independent: attaching the webview never
/// reveals it (it may still show another entry's content). Only `reveal()`,
/// called on `renderCompleted`, hides the overlay. This is what prevents the
/// old page from flashing through during push/pop transitions.
final class VisitableViewController: UIViewController {
    let entryId: String
    let url: String

    private enum Overlay {
        case none
        case placeholder
        case snapshot(UIImage)
    }

    /// Desired overlay; may be set before the view is loaded (e.g. while a
    /// push is being prepared). Applied in viewDidLoad and on every change.
    private var overlay: Overlay = .placeholder {
        didSet { applyOverlayIfLoaded() }
    }

    private let snapshotImageView = UIImageView()
    private let placeholderView = UIView()

    // ── Lifecycle ─────────────────────────────────────────────────────

    init(entry: KineticEntry) {
        entryId = entry.id
        url = entry.url
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { nil }

    override func viewDidLoad() {
        super.viewDidLoad()
        // must match the page background to avoid flashes (incl. dark mode)
        view.backgroundColor = .systemBackground

        // the snapshot is a pixel-identical capture of this view's bounds;
        // no letterboxing wanted
        snapshotImageView.contentMode = .scaleToFill
        snapshotImageView.frame = view.bounds
        snapshotImageView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(snapshotImageView)

        placeholderView.backgroundColor = .systemBackground
        placeholderView.frame = view.bounds
        placeholderView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(placeholderView)

        applyOverlay()
    }

    // ── Overlay / WebView management ─────────────────────────────────

    /// Freeze this screen with a snapshot of its page (kept while the webview
    /// is elsewhere, and while re-rendering after a pop).
    func show(snapshot: UIImage) {
        overlay = .snapshot(snapshot)
    }

    /// Neutral cover for entries without a snapshot (fresh pushes, deep-link
    /// intermediates, evicted snapshots).
    func showPlaceholder() {
        overlay = .placeholder
    }

    /// Move the live webview into this screen, *under* the current overlay.
    /// Call `reveal()` once the webview's content matches this entry.
    func attachWebView(_ webView: WKWebView) {
        loadViewIfNeeded()

        if webView.superview !== view {
            webView.removeFromSuperview()
            webView.frame = view.bounds
            webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            view.insertSubview(webView, at: 0)
        }
    }

    func holdsWebView(_ webView: WKWebView) -> Bool {
        isViewLoaded && webView.superview === view
    }

    /// Hide the overlay, revealing the live webview (renderCompleted).
    func reveal() {
        overlay = .none
    }

    private func applyOverlayIfLoaded() {
        guard isViewLoaded else { return }
        applyOverlay()
    }

    private func applyOverlay() {
        switch overlay {
        case .none:
            snapshotImageView.isHidden = true
            snapshotImageView.image = nil
            placeholderView.isHidden = true
        case .placeholder:
            snapshotImageView.isHidden = true
            snapshotImageView.image = nil
            placeholderView.isHidden = false
        case .snapshot(let image):
            snapshotImageView.image = image
            snapshotImageView.isHidden = false
            placeholderView.isHidden = true
        }
    }
}
