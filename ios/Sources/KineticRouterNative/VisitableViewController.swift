import UIKit
import WebKit

/// One per navigation entry.  Holds a snapshot of the frozen page and a
/// slot for the live `WKWebView` (only one entry at a time holds it).
final class VisitableViewController: UIViewController {
    let entryId: String
    let url: String

    private let snapshotImageView = UIImageView()
    private let placeholderView = UIView()
    private var webViewSlot: UIView?

    // ── Lifecycle ─────────────────────────────────────────────────────

    init(entry: KineticEntry) {
        entryId = entry.id
        url = entry.url
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { nil }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        snapshotImageView.contentMode = .scaleToFill
        snapshotImageView.frame = view.bounds
        snapshotImageView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        snapshotImageView.isHidden = true
        view.addSubview(snapshotImageView)

        placeholderView.backgroundColor = .systemBackground
        placeholderView.frame = view.bounds
        placeholderView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        placeholderView.isHidden = true
        view.addSubview(placeholderView)
    }

    // ── Snapshot / WebView management ────────────────────────────────

    func show(snapshot: UIImage?) {
        snapshotImageView.image = snapshot
        snapshotImageView.isHidden = false
        placeholderView.isHidden = true
    }

    func showWebView(_ webView: WKWebView) {
        // Remove webview from its previous parent (if any).
        if webView.superview !== view {
            webView.removeFromSuperview()
        }

        webView.frame = view.bounds
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.insertSubview(webView, at: 0)

        snapshotImageView.isHidden = true
        placeholderView.isHidden = true
    }

    func showPlaceholder() {
        placeholderView.isHidden = false
        snapshotImageView.isHidden = true
    }

    func removeSnapshot() {
        snapshotImageView.image = nil
        snapshotImageView.isHidden = true
    }
}
