import class UIKit.UIImage

/// Per-entry metadata in the native stack.
struct KineticEntry: Sendable {
    let id: String
    let url: String
    var state: SendableJSON?
    var title: String?
    var snapshot: UIImage?
}

/// Owns the entry table that mirrors the native nav stack.
@MainActor
final class EntryStore {
    private(set) var entries: [KineticEntry] = []

    /// Maximum number of cached snapshots to keep in memory.
    /// When this limit is exceeded, snapshots are evicted from entries
    /// furthest from the top of the stack (middle entries first).
    var maxSnapshotCount = 25

    func count() -> Int { entries.count }

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

    func replace(at index: Int, with entry: KineticEntry) -> KineticEntry? {
        guard index < entries.count else { return nil }
        let old = entries[index]
        entries[index] = entry
        return old
    }

    subscript(index: Int) -> KineticEntry? {
        guard index >= 0, index < entries.count else { return nil }
        return entries[index]
    }

    // ── Snapshot memory management ──────────────────────────────────

    private func evictSnapshotsIfNeeded() {
        let snapshotCount = entries.filter { $0.snapshot != nil }.count
        guard snapshotCount > maxSnapshotCount else { return }

        // Evict from the middle of the stack first (keep top and root).
        let evictCount = snapshotCount - maxSnapshotCount
        var evicted = 0
        for i in 1..<(entries.count - 1) where entries[i].snapshot != nil {
            entries[i].snapshot = nil
            evicted += 1
            if evicted >= evictCount { break }
        }
    }
}
