import UIKit

/// App-supplied overrides for specific routes, keyed on the `tag` that the
/// route declares in its native static data (JS side).  No URL matching lives
/// in Swift — route identity stays in JS.
///
/// - `.webPush`:      default; pushes the webview onto the nav stack.
/// - `.webModal`:     presents the webview modally.
/// - `.native`:       replaces the webview screen with a fully native
///                    UIViewController (e.g. a native settings form).
///                    The factory receives the route URL and any state.
public enum RouteBehaviour: Sendable {
    case webPush
    case webModal
    case native(factory: @MainActor @Sendable (_ url: String, _ state: [String: Any]?) -> UIViewController)
}

/// Tag-based route lookup (no URL matching).  Supply an instance to
/// `KineticSession` if your app has native screens mixed into the stack.
/// Routes without an override follow the `presentation` hint declared in
/// their JS-side native metadata (defaulting to a push).
public struct RouteConfiguration: Sendable {
    let behaviours: [String: RouteBehaviour]

    public init(behaviours: [String: RouteBehaviour] = [:]) {
        self.behaviours = behaviours
    }

    /// The explicit override for this tag, if the app supplied one.
    func override(for tag: String) -> RouteBehaviour? {
        behaviours[tag]
    }
}
