import { motion } from '@kinetic-router/animations'
import { Lifecycle as Lc } from '@kinetic-router/lifecycle'
import { createSignal, onCleanup } from 'solid-js'
import './postcard-studio.css'

function Postcard(props: { shown: boolean; tilted: boolean; slow: boolean; discard: () => void; onDiscarded: () => void }) {
  const [note, setNote] = createSignal('')
  onCleanup(() => props.onDiscarded())

  return <motion.section
    class="postcard"
    aria-label="Afterglow postcard"
    inert={!props.shown}
    initial={{ opacity: 0.65, y: 24 }}
    animate={{ opacity: 1, x: props.tilted ? 28 : 0, y: 0, rotate: props.tilted ? -5 : 0, scale: props.tilted ? 0.94 : 1 }}
    exit={{ opacity: 0, y: 24 }}
    transition={{ duration: props.slow ? 4 : 1.1, delay: props.slow ? 0.125 : 0, ease: 'easeOut' }}
    onKeyDown={(event: KeyboardEvent) => { if (event.key === 'Escape') props.discard() }}
  >
    <div class="postcard-print" aria-hidden="true"><span>35° N / 08° W</span><span>FIG. 01</span></div>
    <div class="postcard-paper">
      <div class="postcard-edition"><span>FIELD NOTES</span><span>COLOR STUDY № 01</span></div>
      <h3>Afterglow</h3>
      <label>Note to self <input value={note()} onInput={event => setNote(event.currentTarget.value)}
        placeholder="Remember this light…" maxlength="80" /></label>
    </div>
  </motion.section>
}

export function PostcardStudio() {
  const [shown, setShown] = createSignal(true)
  const [tilted, setTilted] = createSignal(false)
  const [slow, setSlow] = createSignal(false)
  const [canUndo, setCanUndo] = createSignal(false, { ownedWrite: true })
  let discardButton: HTMLButtonElement | undefined

  function discard() {
    // Move focus before the retained postcard (and its input) becomes inert.
    discardButton?.focus()
    setCanUndo(true)
    setShown(false)
  }

  return <section class="postcard-studio" aria-labelledby="postcard-studio-title">
    <div class="postcard-intro">
      <span>PLAYGROUND / 01</span>
      <h2 id="postcard-studio-title">Postcard studio</h2>
      <p>Write a note, try a tilt, then discard your draft (or press Esc in the note). Undo while it’s leaving to keep your note.</p>
    </div>
    <div class="postcard-tools">
      <motion.button type="button" class="postcard-discard" ref={(element: HTMLButtonElement) => { discardButton = element }}
        initial={false} animate={{ opacity: 1 }} onClick={() => shown() ? discard() : setShown(true)}>
        {shown() ? 'Discard draft' : canUndo() ? 'Undo discard' : 'New postcard'}
      </motion.button>
      <motion.button type="button" aria-pressed={tilted() ? 'true' : 'false'}
        animate={tilted() ? { opacity: 0.8, scale: 1.05 } : { opacity: 1 }}
        transition={{ duration: slow() ? 4 : 0.2 }}
        onClick={() => setTilted(value => !value)}>Tilt postcard</motion.button>
      <label><input type="checkbox" checked={slow()} onChange={event => setSlow(event.currentTarget.checked)} /> Slow preview</label>
    </div>
    <div class="postcard-stage">
      <span class="postcard-empty" aria-hidden="true">DRAFT TRAY</span>
      <Lc.Show when={shown()}>
        <Postcard shown={shown()} tilted={tilted()} slow={slow()} discard={discard} onDiscarded={() => setCanUndo(false)} />
      </Lc.Show>
    </div>
  </section>
}
