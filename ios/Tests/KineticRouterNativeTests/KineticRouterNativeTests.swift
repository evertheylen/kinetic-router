import Testing
@testable import KineticRouterNative

struct EntryStoreTests {
    @Test func appendAndAccess() async {
        let store = EntryStore()
        let entry = KineticEntry(id: "a", url: "/home")
        store.append(entry)
        #expect(store.count() == 1)
        #expect(store[0]?.id == "a")
        #expect(store[0]?.url == "/home")
    }

    @Test func removeLast() async {
        let store = EntryStore()
        store.append(KineticEntry(id: "a", url: "/a"))
        store.append(KineticEntry(id: "b", url: "/b"))
        let removed = store.removeLast()
        #expect(removed?.id == "b")
        #expect(store.count() == 1)
    }

    @Test func replace() async {
        let store = EntryStore()
        store.append(KineticEntry(id: "a", url: "/a"))
        let old = store.replace(at: 0, with: KineticEntry(id: "b", url: "/b"))
        #expect(old?.id == "a")
        #expect(store[0]?.id == "b")
    }

    @Test func removeAllAfter() async {
        let store = EntryStore()
        store.append(KineticEntry(id: "a", url: "/a"))
        store.append(KineticEntry(id: "b", url: "/b"))
        store.append(KineticEntry(id: "c", url: "/c"))
        let removed = store.removeAll(after: 0)
        #expect(removed.count == 2)
        #expect(removed[0].id == "b")
        #expect(removed[1].id == "c")
        #expect(store.count() == 1)
    }

    @Test func subscriptOutOfBounds() async {
        let store = EntryStore()
        #expect(store[-1] == nil)
        #expect(store[0] == nil)
        #expect(store[100] == nil)
    }
}

struct MessagesTests {
    @Test func decodeReadyMessage() throws {
        let raw: [String: Any] = [
            "type": "ready",
            "protocolVersion": 1,
            "url": "https://example.com",
            "bundleVersion": "1.0"
        ]
        let msg = try decodeJsMessage(raw)
        guard case .ready(let ready) = msg else {
            Issue.record("Expected .ready, got \(msg)")
            return
        }
        #expect(ready.protocolVersion == 1)
        #expect(ready.url == "https://example.com")
        #expect(ready.bundleVersion == "1.0")
    }

    @Test func decodeVisitProposedMessage() throws {
        let raw: [String: Any] = [
            "type": "visitProposed",
            "url": "/users/alice",
            "state": ["slugs": ["users", NSNull()]] as [String: Any],
            "action": "push",
            "routePattern": "users/<param>",
            "native": ["presentation": "push"]
        ]
        let msg = try decodeJsMessage(raw)
        guard case .visitProposed(let visit) = msg else {
            Issue.record("Expected .visitProposed")
            return
        }
        #expect(visit.url == "/users/alice")
        #expect(visit.action == "push")
        #expect(visit.routePattern == "users/<param>")
        #expect(visit.native?.presentation == "push")
    }

    @Test func decodeUnrecognizedMessage() {
        let raw: [String: Any] = ["type": "bogus"]
        do {
            _ = try decodeJsMessage(raw)
            Issue.record("Expected error")
        } catch {
            // Expected.
        }
    }
}

struct KineticEntryTests {
    @Test func entryProperties() async {
        var entry = KineticEntry(id: "e1", url: "/home")
        #expect(entry.id == "e1")
        #expect(entry.url == "/home")
        #expect(entry.title == nil)
        #expect(entry.snapshot == nil)

        entry.title = "Home"
        #expect(entry.title == "Home")
    }
}
