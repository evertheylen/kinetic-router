import { LayoutList } from '@kinetic-router/layout'
import { onInOut, useLifecycle } from '@kinetic-router/lifecycle'
import { createSignal, Show } from 'solid-js'
import './reading-queue.css'

type Entry = { id: number; title: string }
type Removal = { entry: Entry; index: number }

const normalDuration = 0.25
const firstEntries: Entry[] = [
  { id: 1, title: 'The night atlas' },
  { id: 2, title: 'Notes from the coast' },
  { id: 3, title: 'The cloud garden' },
  { id: 4, title: 'A field guide to rain' },
  { id: 5, title: 'Letters from the north' },
]

function Row(props: {
  entry: Entry
  index: number
  remove: (removal: Removal) => void
  restoreNoteFocus: (id: number, input: HTMLInputElement) => void
}) {
  const { phase } = useLifecycle()
  const [note, setNote] = createSignal('')
  const remove = () => props.remove({ entry: props.entry, index: props.index })
  let noteInput: HTMLInputElement | undefined

  // The row has committed by this point, including clearing inert on reentry.
  onInOut(({ direction }) => {
    if (direction === 'in' && noteInput) props.restoreNoteFocus(props.entry.id, noteInput)
  })

  return <li class="layout-queue-row" data-entry={props.entry.id} inert={phase() === 'exiting'}
    onKeyDown={event => { if (event.key === 'Escape') remove() }}>
    <span class="layout-queue-number" aria-hidden="true">{String(props.index + 1).padStart(2, '0')}</span>
    <label>{props.entry.title}
      <input ref={element => { noteInput = element }} aria-label={`${props.entry.title} note`}
        value={note()} onInput={event => setNote(event.currentTarget.value)} placeholder="A note for later…" />
    </label>
    <button type="button" aria-label={`Remove ${props.entry.title}`} onClick={remove}>Remove</button>
  </li>
}

export function ReadingQueue() {
  const [items, setItems] = createSignal(firstEntries)
  const [removed, setRemoved] = createSignal<Removal>()
  const [shown, setShown] = createSignal(true)
  const [duration, setDuration] = createSignal(normalDuration)
  let nextId = firstEntries.length + 1
  let undoButton: HTMLButtonElement | undefined
  let restoreNoteFor: number | undefined

  function restoreNoteFocus(id: number, input: HTMLInputElement) {
    if (restoreNoteFor !== id) return
    restoreNoteFor = undefined
    input.focus()
  }

  function remove(removal: Removal) {
    // Move focus before the retained row becomes inert. Undo stays outside the list.
    undoButton?.focus()
    setRemoved(removal)
    setItems(entries => entries.filter(entry => entry.id !== removal.entry.id))
  }

  function undo() {
    const removal = removed()
    if (!removal) return
    const { entry, index } = removal
    restoreNoteFor = entry.id
    setItems(entries => [...entries.slice(0, index), entry, ...entries.slice(index)])
    setRemoved(undefined)
    setShown(true)
  }

  function add() {
    const id = nextId++
    setItems(entries => [{ id, title: `Untitled volume ${id}` }, ...entries])
  }

  return <section class="layout-queue" aria-labelledby="layout-queue-title">
    <div class="layout-queue-intro">
      <span>02 / REORDER A GRID</span>
      <h2 id="layout-queue-title">Reading queue</h2>
      <p class="motion-instructions">Choose <strong>Slow</strong>, then <strong>Rotate queue</strong>. The first card moves to the end
        while the others slide into their new places. Rotate again before they settle to interrupt the move.
        To try Undo, write a note, press Esc in it, then press Enter while its card is fading. Your note comes back.</p>
      <p class="reduced-motion-instructions">Reduced motion is on, so the cards change places without sliding, even on Slow.
        Write a note in the first card, then choose <strong>Rotate queue</strong>. The note stays with its title in its new spot.</p>
    </div>
    <div class="layout-queue-tools">
      <button type="button" onClick={() => setItems(entries => entries.length > 1 ? [...entries.slice(1), entries[0]!] : entries)}
        disabled={items().length < 2}>Rotate queue</button>
      <button type="button" onClick={add}>Add title</button>
      <button type="button" aria-disabled={removed() ? 'false' : 'true'} ref={element => { undoButton = element }}
        onClick={undo}>Undo removal</button>
      <button type="button" aria-expanded={shown() ? 'true' : 'false'} title="Hiding the list resets drafts"
        onClick={() => setShown(value => !value)}>{shown() ? 'Hide list' : 'Show list'}</button>
      <label>Animation speed
        <select value={String(duration())} onChange={event => setDuration(Number(event.currentTarget.value))}>
          <option value={String(normalDuration)}>Normal</option>
          <option value="2">Slow</option>
          <option value="0">Instant</option>
        </select>
      </label>
    </div>
    <div class="layout-queue-tray">
      <Show when={shown()}>
        <ul class="layout-queue-list" role="list" aria-label="Queued titles" style="position:relative">
          <LayoutList each={items()} by={item => item.id} transition={{ duration: duration(), ease: 'ease-out' }}>
            {(item, index) => <Row entry={item()} index={index()} remove={remove} restoreNoteFocus={restoreNoteFocus} />}
          </LayoutList>
        </ul>
      </Show>
      <p class="layout-queue-summary" aria-live="polite">{items().length} {items().length === 1 ? 'title' : 'titles'} in queue</p>
    </div>
  </section>
}
