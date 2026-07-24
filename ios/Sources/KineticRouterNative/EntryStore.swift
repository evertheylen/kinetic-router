import class UIKit.UIImage

/// Per-entry metadata in the native stack.
public struct KineticEntry: Sendable {
    let id: String
    var url: String
    var state: SendableJSON?
    var title: String?
    var snapshot: UIImage?

    init(id: String, url: String, state: SendableJSON? = nil, title: String? = nil, snapshot: UIImage? = nil) {
        self.id = id
        self.url = url
        self.state = state
        self.title = title
        self.snapshot = snapshot
    }
}

/// Owns the entry table that mirrors the native nav stack. All mutation goes
/// through methods (`entries` is read-only for other types).
@MainActor
public final class EntryStore {
    private(set) var entries: [KineticEntry] = []

    /// Maximum number of cached snapshots to keep in memory.
    /// When this limit is exceeded, snapshots are evicted from entries
    /// closest to the bottom of the stack (excluding the root); an entry
    /// whose snapshot was evicted shows a placeholder until re-rendered.
    var maxSnapshotCount = 25

    var last: KineticEntry? { entries.last }

    func count() -> Int { entries.count }

    func entry(withId id: String) -> KineticEntry? {
        entries.first { $0.id == id }
    }

    func append(_ entry: KineticEntry) {
        entries.append(entry)
        evictSnapshotsIfNeeded()
    }

    func removeLast() -> KineticEntry? {
        guard !entries.isEmpty else { return nil }
        return entries.removeLast()
    }

    func removeAll(after index: Int) -> [KineticEntry] {
        guard index + 1 < entries.count else { return [] }
        let removed = Array(entries[(index + 1)...])
        entries.removeSubrange((index + 1)...)
        return removed
    }

    /// Removes (and returns) all entries matching the predicate. Used by the
    /// navigation controller to trim entries whose view controllers left the
    /// stack — robust against native view controllers, which have no entry.
    func removeEntries(where shouldRemove: (KineticEntry) -> Bool) -> [KineticEntry] {
        let removed = entries.filter(shouldRemove)
        entries.removeAll(where: shouldRemove)
        return removed
    }

    func removeAllEntries() {
        entries.removeAll()
    }

    func replace(at index: Int, with entry: KineticEntry) -> KineticEntry? {
        guard index >= 0, index < entries.count else { return nil }
        let old = entries[index]
        entries[index] = entry
        return old
    }

    func updateTitle(_ title: String, forId id: String) {
        guard let idx = entries.firstIndex(where: { $0.id == id }) else { return }
        entries[idx].title = title
    }

    func updateState(_ state: SendableJSON?, forId id: String) {
        guard let idx = entries.firstIndex(where: { $0.id == id }) else { return }
        entries[idx].state = state
    }

    func updateUrl(_ url: String, forId id: String) {
        guard let idx = entries.firstIndex(where: { $0.id == id }) else { return }
        entries[idx].url = url
    }

    func setSnapshot(_ snapshot: UIImage?, forId id: String) {
        guard let idx = entries.firstIndex(where: { $0.id == id }) else { return }
        entries[idx].snapshot = snapshot
        evictSnapshotsIfNeeded()
    }

    subscript(index: Int) -> KineticEntry? {
        guard index >= 0, index < entries.count else { return nil }
        return entries[index]
    }

    // ── Snapshot memory management ──────────────────────────────────

    private func evictSnapshotsIfNeeded() {
        guard entries.count > 2 else { return }

        let snapshotCount = entries.count { $0.snapshot != nil }
        guard snapshotCount > maxSnapshotCount else { return }

        let evictCount = snapshotCount - maxSnapshotCount
        var evicted = 0
        for i in 1..<(entries.count - 1) where entries[i].snapshot != nil {
            entries[i].snapshot = nil
            evicted += 1
            if evicted >= evictCount { break }
        }
    }
}
