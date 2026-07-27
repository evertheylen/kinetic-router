import SwiftUI
import KineticRouterNative

@main
struct ExampleApp: App {
    private let session = KineticSession(bundleURL: URL(string: "http://127.0.0.1:3000")!)

    var body: some Scene {
        WindowGroup {
            KineticNavigationView(session: session)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .ignoresSafeArea()
        }
    }
}
