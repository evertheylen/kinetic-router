import SwiftUI
import UIKit

/// SwiftUI wrapper so `KineticNavigationController` can drop into any
/// SwiftUI layout (tab bars, sheets, navigation stacks).
@MainActor
public struct KineticNavigationView: UIViewControllerRepresentable {
    let session: KineticSession

    public init(session: KineticSession) {
        self.session = session
    }

    public func makeUIViewController(context: Context) -> KineticNavigationController {
        let navController = KineticNavigationController(session: session)
        return navController
    }

    public func updateUIViewController(_ uiViewController: KineticNavigationController, context: Context) {
        // Session state is driven by JS messages; no structural updates needed.
    }

    /// A navigation controller has no useful intrinsic size in SwiftUI. Honor
    /// the parent proposal so a root `KineticNavigationView` fills its scene.
    public func sizeThatFits(
        _ proposal: ProposedViewSize,
        uiViewController: KineticNavigationController,
        context: Context
    ) -> CGSize? {
        guard let width = proposal.width, let height = proposal.height else { return nil }
        return CGSize(width: width, height: height)
    }
}
