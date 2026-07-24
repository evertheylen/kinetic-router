import Foundation
import Testing
@testable import KineticRouterNative

@MainActor
struct EntryStoreTests {
    @Test func appendAndAccess() async {
        let store = EntryStore()
        let entry = KineticEntry(id: "a", url: "/home")
        store.append(entry)
        #expect(store.count() == 1)
        #expect(store[0]?.id == "a")
        #expect(store[0]?.url == "/home")
        #expect(store.entry(withId: "a")?.url == "/home")
        #expect(store.last?.id == "a")
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

    @Test func removeEntriesWhere() async {
        let store = EntryStore()
        store.append(KineticEntry(id: "a", url: "/a"))
        store.append(KineticEntry(id: "b", url: "/b"))
        store.append(KineticEntry(id: "c", url: "/c"))
        let live: Set<String> = ["a", "c"]
        let removed = store.removeEntries { !live.contains($0.id) }
        #expect(removed.map(\.id) == ["b"])
        #expect(store.entries.map(\.id) == ["a", "c"])
    }

    @Test func updateHelpers() async {
        let store = EntryStore()
        store.append(KineticEntry(id: "a", url: "/a"))
        store.updateTitle("Title", forId: "a")
        store.updateUrl("/a2", forId: "a")
        store.updateState(.bool(true), forId: "a")
        #expect(store.entry(withId: "a")?.title == "Title")
        #expect(store.entry(withId: "a")?.url == "/a2")

        // unknown ids are ignored
        store.updateTitle("X", forId: "nope")
        #expect(store.entry(withId: "a")?.title == "Title")
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
            "protocolVersion": 2,
            "url": "https://example.com",
            "bundleVersion": "1.0",
            "initialEntryId": "__native_local_0"
        ]
        let msg = try decodeJsMessage(raw)
        guard case .ready(let ready) = msg else {
            Issue.record("Expected .ready, got \(msg)")
            return
        }
        #expect(ready.protocolVersion == 2)
        #expect(ready.url == "https://example.com")
        #expect(ready.bundleVersion == "1.0")
        #expect(ready.initialEntryId == "__native_local_0")
    }

    @Test func decodeVisitProposedMessage() throws {
        let raw: [String: Any] = [
            "type": "visitProposed",
            "proposalId": "__proposal_3",
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
        #expect(visit.proposalId == "__proposal_3")
        #expect(visit.url == "/users/alice")
        #expect(visit.action == "push")
        #expect(visit.routePattern == "users/<param>")
        #expect(visit.native?.presentation == "push")
    }

    @Test func decodeStateUpdatedWithUrl() throws {
        let raw: [String: Any] = [
            "type": "stateUpdated",
            "entryId": "__native_local_0",
            "state": NSNull(),
            "url": "/home"
        ]
        let msg = try decodeJsMessage(raw)
        guard case .stateUpdated(let update) = msg else {
            Issue.record("Expected .stateUpdated")
            return
        }
        #expect(update.entryId == "__native_local_0")
        #expect(update.url == "/home")
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
