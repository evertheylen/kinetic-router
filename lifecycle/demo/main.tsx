import { createSignal, onCleanup, Show, untrack, type Element as SolidElement } from 'solid-js'
import { render } from '@solidjs/web'
import { Lifecycle, onExit, useLifecycle, type Direction } from '../src/index.js'
import { createAnimation, createCssTransition, createTransition, fade, fadeScale, slide, spring } from '../../animations/src/index.js'
import './style.css'

const [duration, setDuration] = createSignal(1800)
// Diagnostic counters intentionally update during component setup/cleanup.
const [mounts, setMounts] = createSignal(0, { ownedWrite: true })
const [disposals, setDisposals] = createSignal(0, { ownedWrite: true })

function wait(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve() }
    const timer = setTimeout(finish, milliseconds)
    signal.addEventListener('abort', finish, { once: true })
  })
}

function ExitCard(props: { title: string; children?: SolidElement; fast?: boolean }) {
  const motion = createTransition({ out: [
    { opacity: 1, transform: 'translateX(0)' }, { opacity: 0.25, transform: 'translateX(12px)' },
  ] }, { duration: props.fast ? 175 : 250 })
  const instance = untrack(mounts) + 1
  setMounts(instance)
  onCleanup(() => setDisposals(value => value + 1))
  const lifecycle = useLifecycle()
  const [clicks, setClicks] = createSignal(0)
  // Independent work still retains the card after its short animation finishes.
  onExit(({ signal }) => wait(props.fast ? 350 : duration(), signal))
  return <div class="card" ref={motion} data-phase={lifecycle.phase()}>
    <header><strong>{props.title}</strong><code>#{instance} · {lifecycle.phase()}</code></header>
    <label>Local state <input aria-label={`${props.title} state`} placeholder="Type; remove; restore before exit ends" /></label>
    <button onClick={() => setClicks(value => value + 1)}>Still interactive: {clicks()}</button>
    {props.children}
  </div>
}

function CssCard(props: { reversible: boolean }) {
  const reversible = untrack(() => props.reversible)
  const instance = untrack(mounts) + 1
  setMounts(instance)
  onCleanup(() => setDisposals(value => value + 1))
  const lifecycle = useLifecycle()
  const [runs, setRuns] = createSignal<Direction[]>([])
  const [clicks, setClicks] = createSignal(0)
  const motion = createCssTransition({
    mode: reversible ? 'inout' : 'separate',
    properties: reversible ? ['opacity'] : [],
    animations: reversible ? [] : ['lifecycle-in', 'lifecycle-out'],
    apply(element, direction) {
      element.dataset.direction = direction
      // Diagnostic log excludes the pre-insertion preparation call.
      if (element.isConnected) setRuns(runs => [...runs, direction])
    },
  })
  return <div
    class={`card ${reversible ? 'css-inout' : 'css-separate'}`}
    ref={motion}
    data-phase={lifecycle.phase()}
    data-runs={runs().join(',')}
    style={{ '--motion-duration': `${duration()}ms` }}
  >
    <header><strong>{reversible ? 'Bidirectional CSS transition' : 'Separate CSS animations'}</strong><code>#{instance}</code></header>
    <label>Local state <input placeholder="State survives reversal" /></label>
    <button onClick={() => setClicks(value => value + 1)}>Still interactive: {clicks()}</button>
    <p>Runs: {runs().join(' → ')}</p>
  </div>
}

function MotionCard(props: { separate: boolean; preset: string; hold: boolean; delay: number; milliseconds: number; outMilliseconds?: number }) {
  const instance = untrack(mounts) + 1
  setMounts(instance)
  onCleanup(() => setDisposals(value => value + 1))
  const preset = props.preset === 'scale' ? fadeScale : props.preset === 'slide' ? slide() : fade
  const motion = createTransition(props.separate
    ? { in: fade.inout, out: [...fade.inout].reverse() }
    : preset, {
      duration: props.outMilliseconds === undefined ? props.milliseconds : { in: props.milliseconds, out: props.outMilliseconds },
      delay: props.delay, easing: 'linear',
    })
  const { phase } = useLifecycle()
  // A manually released gate makes retention after animation completion visible.
  const hold = props.hold
  const [pending, setPending] = createSignal(false)
  let release: (() => void) | undefined
  onExit(({ signal }) => {
    if (!hold) return
    setPending(true)
    return new Promise<void>(resolve => {
      const finish = () => { setPending(false); signal.removeEventListener('abort', finish); resolve() }
      release = finish
      signal.addEventListener('abort', finish, { once: true })
    })
  })
  return <div class="card motion-card" ref={motion} data-phase={phase()} data-pending={String(pending())}>
    <header><strong>Native animation helper</strong><code>#{instance}</code></header>
    <input aria-label="Motion state" placeholder="State survives reversal" />
    <button onClick={() => release?.()}>Release other work</button>
  </div>
}

function MotionDemo() {
  const [visible, show] = createSignal(false)
  const [mounted, mount] = createSignal(true)
  const [separate, setSeparate] = createSignal(false)
  const [hold, setHold] = createSignal(false)
  const [preset, setPreset] = createSignal('fade')
  const [delay, setDelay] = createSignal(250)
  const [milliseconds, setMilliseconds] = createSignal(2000)
  const [directional, setDirectional] = createSignal(false)
  const [outMilliseconds, setOutMilliseconds] = createSignal(1000)
  return <section><h2>Animation helper</h2>
    <p>Settings apply to new instances. Toggle mid-flight to reverse; an ordinary unmount cleans up immediately.</p>
    <label>Preset <select aria-label="Motion preset" value={preset()} onChange={e => setPreset(e.currentTarget.value)}>
      <option value="fade">Fade</option><option value="scale">Fade scale</option><option value="slide">Slide</option>
    </select></label>
    <label><input type="checkbox" checked={separate()} onChange={e => setSeparate(e.currentTarget.checked)} />Separate motion</label>
    <label><input type="checkbox" checked={hold()} onChange={e => setHold(e.currentTarget.checked)} />Hold other work</label>
    <label>Motion duration <input type="number" value={milliseconds()} onInput={e => setMilliseconds(+e.currentTarget.value)} /></label>
    <label>Motion delay <input type="number" value={delay()} onInput={e => setDelay(+e.currentTarget.value)} /></label>
    <label><input type="checkbox" checked={directional()} onChange={e => setDirectional(e.currentTarget.checked)} />Directional duration</label>
    <label>Exit motion duration <input type="number" value={outMilliseconds()} onInput={e => setOutMilliseconds(+e.currentTarget.value)} /></label>
    <nav><button onClick={() => show(value => !value)}>Toggle motion</button>
      <button onClick={() => mount(value => !value)}>Unmount motion control</button></nav>
    <Show when={mounted()}><Lifecycle.Show when={visible()}>
      <MotionCard separate={separate()} preset={preset()} hold={hold()} delay={delay()} milliseconds={milliseconds()}
        outMilliseconds={directional() ? outMilliseconds() : undefined} />
    </Lifecycle.Show></Show>
  </section>
}

function ReactiveCard(props: { position: number }) {
  const motion = createAnimation(() => ({ transform: `translateX(${props.position}px)` }), { duration: 5000, easing: 'linear' })
  return <div class="card reactive-card" ref={motion}>Reactive native target</div>
}

function SpringCard() {
  const motion = createTransition({ inout: [
    { transform: 'translateX(0px)' }, { transform: 'translateX(100px)' },
  ] }, spring())
  return <div class="card spring-card" ref={motion}>Precompiled spring</div>
}

function NativeTargetsDemo() {
  const [position, setPosition] = createSignal(0)
  const [mounted, mount] = createSignal(true)
  const [visible, show] = createSignal(false)
  return <section><h2>Reactive targets and springs</h2>
    <button onClick={() => setPosition(value => value === 0 ? 200 : 0)}>Move target</button>
    <button onClick={() => mount(value => !value)}>Unmount target</button>
    <Show when={mounted()}><ReactiveCard position={position()} /></Show>
    <button onClick={() => show(value => !value)}>Toggle spring</button>
    <Lifecycle.Show when={visible()}><SpringCard /></Lifecycle.Show>
  </section>
}

function SequenceCard(props: { title: string }) {
  const motion = createTransition(fade, { duration: 5000, easing: 'linear' })
  const { phase } = useLifecycle()
  const [pending, setPending] = createSignal(false)
  let release: (() => void) | undefined
  onExit(({ signal }) => {
    setPending(true)
    return new Promise<void>(resolve => {
      const finish = () => { setPending(false); signal.removeEventListener('abort', finish); resolve() }
      release = finish
      signal.addEventListener('abort', finish, { once: true })
    })
  })
  return <div class="card sequence-card" ref={motion} data-name={props.title} data-phase={phase()} data-pending={String(pending())}>
    <strong>{props.title}</strong><input aria-label="Sequence local state" />
    <button onClick={() => release?.()}>Release sequence work</button>
  </div>
}

function SequenceDemo() {
  const [page, setPage] = createSignal('A')
  return <section><h2>Out-in switch</h2>
    <p>The next branch mounts only after this branch's animation and independent work finish.</p>
    <nav>{['A', 'B', 'C', 'fallback'].map(name => <button onClick={() => setPage(name)}>Sequence {name}</button>)}</nav>
    <Lifecycle.Switch mode="out-in" fallback={<SequenceCard title="fallback" />}>
      <Lifecycle.Match when={page() === 'A'}><SequenceCard title="A" /></Lifecycle.Match>
      <Lifecycle.Match when={page() === 'B'}><SequenceCard title="B" /></Lifecycle.Match>
      <Lifecycle.Match when={page() === 'C'}><SequenceCard title="C" /></Lifecycle.Match>
    </Lifecycle.Switch>
  </section>
}

function Demo() {
  const initialItems = [{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }, { id: 3, name: 'Gamma' }]
  const [items, setItems] = createSignal(initialItems)
  const [modal, setModal] = createSignal(false)
  const [page, setPage] = createSignal('home')
  const [parent, setParent] = createSignal(true)
  const [child, setChild] = createSignal(true)
  const [separate, showSeparate] = createSignal(false)
  const [bidirectional, showBidirectional] = createSignal(false)
  return <main>
    <h1>Solid 2 · Lifecycle</h1>
    <p>Retained components, not DOM snapshots. Remove a card, interact with it while exiting,
      then restore it before the exit ends. Its instance number and input state should survive.</p>
    <label>Exit duration: {duration()}ms <input aria-label="Exit duration" type="range" min="500" max="5000" step="100" value={duration()} onInput={event => setDuration(+event.currentTarget.value)} /></label>
    <p aria-live="polite"><code>{mounts()} mounts · {disposals()} disposals</code></p>

    <section><h2>Keyed For</h2>
      <nav>
        <button onClick={() => setItems(items().slice(1))}>Remove first</button>
        <button onClick={() => setItems(initialItems)}>Restore all</button>
        <button onClick={() => setItems([...items()].reverse())}>Reverse</button>
        <button onClick={() => setItems(items().map(item => ({ ...item, name: item.name + '!' })))}>Update objects, same keys</button>
        <button onClick={() => setItems([])}>Remove all</button>
      </nav>
      <Lifecycle.For each={items()} by={item => item.id}>{(item, index) =>
        <ExitCard title={`${index() + 1}. ${item().name}`} />
      }</Lifecycle.For>
    </section>

    <section><h2>Show</h2>
      <button onClick={() => setModal(value => !value)}>Toggle modal</button>
      <Lifecycle.Show when={modal()}><ExitCard title="Modal" /></Lifecycle.Show>
    </section>

    <section><h2>Switch / Match</h2>
      <nav><button onClick={() => setPage('home')}>Home</button><button onClick={() => setPage('settings')}>Settings</button><button onClick={() => setPage('unknown')}>Fallback</button></nav>
      <Lifecycle.Switch fallback={<ExitCard title="Not found" />}>
        <Lifecycle.Match when={page() === 'home'}><ExitCard title="Home" /></Lifecycle.Match>
        <Lifecycle.Match when={page() === 'settings'}><ExitCard title="Settings" /></Lifecycle.Match>
      </Lifecycle.Switch>
    </section>

    <section><h2>Separate in / out</h2>
      <p>Remove during entry: the CSS enter finishes before the CSS exit starts. The initial 250ms delay stays invisible.</p>
      <button onClick={() => showSeparate(value => !value)}>Toggle separate</button>
      <Lifecycle.Show when={separate()}><CssCard reversible={false} /></Lifecycle.Show>
    </section>

    <section><h2>Bidirectional inout</h2>
      <p>Toggle during entry or exit: the CSS transition reverses from its current position, keeping the same instance.</p>
      <button onClick={() => showBidirectional(value => !value)}>Toggle bidirectional</button>
      <Lifecycle.Show when={bidirectional()}><CssCard reversible={true} /></Lifecycle.Show>
    </section>

    <MotionDemo />
    <NativeTargetsDemo />
    <SequenceDemo />

    <section><h2>Independent nested flows</h2>
      <p>Toggling the parent only animates the parent. Toggling the child changes its own Show and starts its 350ms exit, even while the parent is exiting.</p>
      <nav><button onClick={() => setParent(value => !value)}>Toggle parent</button><button onClick={() => setChild(value => !value)}>Toggle child</button></nav>
      <Lifecycle.Show when={parent()}><ExitCard title="Parent">
        <Lifecycle.Show when={child()}><ExitCard title="Child" fast /></Lifecycle.Show>
      </ExitCard></Lifecycle.Show>
    </section>
  </main>
}

render(() => <Demo />, document.getElementById('app')!)
