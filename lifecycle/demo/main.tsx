import { createMemo, createSignal, Loading, onCleanup, Show, untrack, type Element as SolidElement } from 'solid-js'
import { render } from '@solidjs/web'
import { Lifecycle, onExit, useLifecycle, type Direction } from '../src/index.js'
import { createAnimation, createCssTransition, createTransition, fade, fadeScale, slide, spring } from '../../animations/src/index.js'
import './style.css'
import { PostcardStudio } from './postcard-studio.js'
import { ReadingQueue } from './reading-queue.js'

// Diagnostic counters intentionally update during component setup/cleanup.
const [mounts, setMounts] = createSignal(0, { ownedWrite: true })
const [disposals, setDisposals] = createSignal(0, { ownedWrite: true })

function trackInstance() {
  onCleanup(() => setDisposals(value => value + 1))
  return setMounts(value => value + 1)
}

/** User-controlled work, independent of how quickly the visual effect finishes. */
function ExitGate(props: { label: string }) {
  const [release, setRelease] = createSignal<() => void>()
  onExit(({ signal }) => {
    return new Promise<void>(resolve => {
      function finish() {
        signal.removeEventListener('abort', finish)
        setRelease(undefined)
        resolve()
      }
      setRelease(() => finish)
      signal.addEventListener('abort', finish, { once: true })
    })
  })
  return <button disabled={!release()} onClick={() => release()?.()}>{props.label}</button>
}

function FlowCard(props: { title: string; children?: SolidElement; fast?: boolean }) {
  const motion = createCssTransition({
    apply: (element, direction) => { element.classList.toggle('leaving', direction === 'out') },
    properties: ['opacity', 'transform'],
  })
  const instance = trackInstance()
  const lifecycle = useLifecycle()
  const [clicks, setClicks] = createSignal(0)
  return <div class="card flow-card" ref={motion} style={{ '--motion-duration': props.fast ? '350ms' : undefined }}>
    <header><strong>{props.title}</strong><code>#{instance} · {lifecycle.phase()}</code></header>
    <label>Local state <input aria-label={`${props.title} state`} placeholder="Type; remove; restore before exit ends" /></label>
    <button onClick={() => setClicks(value => value + 1)}>Still interactive: {clicks()}</button>
    {props.children}
  </div>
}

function CssCard(props: { reversible: boolean }) {
  const reversible = untrack(() => props.reversible)
  const instance = trackInstance()
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
  return <>
    <div class={`card ${reversible ? 'css-inout' : 'css-separate'}`} ref={motion}
      data-phase={lifecycle.phase()} data-runs={runs().join(',')}>
      <header><strong>{reversible ? 'Bidirectional CSS transition' : 'Separate CSS animations'}</strong><code>#{instance}</code></header>
      <p>Runs: {runs().join(' → ')}</p>
    </div>
    <label>Local state <input placeholder="State survives reversal" /></label>
    <button onClick={() => setClicks(value => value + 1)}>Still interactive: {clicks()}</button>
  </>
}

type MotionMode = 'inout' | 'separate' | 'exit-only'

function MotionCard(props: { mode: MotionMode; preset: string; hold: boolean; delay: number; milliseconds: number; outMilliseconds?: number }) {
  const instance = trackInstance()
  // The controls configure the next instance, not an animation already in flight.
  const { preset: presetName, mode, milliseconds, outMilliseconds, delay, hold } = untrack(() => ({ ...props }))
  const preset = presetName === 'scale' ? fadeScale : presetName === 'slide' ? slide() : fade
  const motion = createTransition(mode === 'inout' ? preset : {
    in: mode === 'separate' ? preset.inout : undefined,
    out: [...preset.inout].reverse(),
  }, {
    duration: outMilliseconds === undefined ? milliseconds : { in: milliseconds, out: outMilliseconds },
    delay, easing: 'linear',
  })
  const { phase } = useLifecycle()
  return <>
    <div class="card motion-card" ref={motion} data-phase={phase()}>
      <header><strong>Native animation helper</strong><code>#{instance}</code></header>
    </div>
    <input aria-label="Motion state" placeholder="State survives reversal" />
    {hold && <ExitGate label="Release other work" />}
  </>
}

function Milliseconds(props: { label: string; value: number; set: (value: number) => void }) {
  return <label>{props.label} <input type="number" min="0" step="any" value={props.value} onInput={event => {
    const input = event.currentTarget
    if (input.validity.valid && Number.isFinite(input.valueAsNumber)) props.set(input.valueAsNumber)
  }} /></label>
}

function MotionDemo() {
  const [visible, show] = createSignal(false)
  const [mounted, mount] = createSignal(true)
  const [mode, setMode] = createSignal<MotionMode>('inout')
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
    <label>Motion mode <select value={mode()} onChange={e => setMode(e.currentTarget.value as MotionMode)}>
      <option value="inout">Reversible</option><option value="separate">Separate entry and exit</option><option value="exit-only">Exit only</option>
    </select></label>
    <label><input type="checkbox" checked={hold()} onChange={e => setHold(e.currentTarget.checked)} />Hold other work</label>
    <Milliseconds label="Motion duration" value={milliseconds()} set={setMilliseconds} />
    <Milliseconds label="Motion delay" value={delay()} set={setDelay} />
    <label><input type="checkbox" checked={directional()} onChange={e => setDirectional(e.currentTarget.checked)} />Directional duration</label>
    <Milliseconds label="Exit motion duration" value={outMilliseconds()} set={setOutMilliseconds} />
    <nav><button onClick={() => show(value => !value)}>Toggle motion</button>
      <button onClick={() => mount(value => !value)}>Unmount motion control</button></nav>
    <Show when={mounted()}><Lifecycle.Show when={visible()}>
      <MotionCard mode={mode()} preset={preset()} hold={hold()} delay={delay()} milliseconds={milliseconds()}
        outMilliseconds={directional() ? outMilliseconds() : undefined} />
    </Lifecycle.Show></Show>
  </section>
}

function LoadingMotionDemo() {
  const [visible, show] = createSignal(false)
  const [separate, setSeparate] = createSignal(false)
  const [hold, setHold] = createSignal(false)
  let release: (() => void) | undefined
  function Content() {
    const loaded = createMemo(() => new Promise<string>(resolve => {
      release = () => resolve('Motion loaded')
    }))
    return <>
      <Loading fallback={<p>Loading motion…</p>}>
        <MotionCard mode={separate() ? 'separate' : 'inout'} preset="fade" hold={false} delay={250} milliseconds={500} />
        <CssCard reversible={!separate()} />
        <p>{loaded()}</p>
      </Loading>
      {hold() && <ExitGate label="Release suspended exit" />}
    </>
  }
  return <section><h2>Suspended motion</h2>
    <p>First frames are prepared while loading; lifecycle work starts only when the content commits.</p>
    <label><input type="checkbox" checked={separate()} onChange={e => setSeparate(e.currentTarget.checked)} />Separate suspended motion</label>
    <label><input type="checkbox" checked={hold()} onChange={e => setHold(e.currentTarget.checked)} />Hold suspended exit</label>
    <nav><button onClick={() => show(value => !value)}>Toggle suspended motion</button>
      <button onClick={() => release?.()}>Resolve motion loading</button></nav>
    <Lifecycle.Show when={visible()}><Content /></Lifecycle.Show>
  </section>
}

function ReactiveCard(props: { position: number; angle: number }) {
  const motion = createAnimation(() => ({ transform: `translateX(${props.position}px) rotate(${props.angle}deg)` }), { duration: 5000, easing: 'linear' })
  return <div class="card reactive-card" ref={motion}>Reactive native target</div>
}

function SpringCard() {
  const motion = createTransition({ inout: [
    { transform: 'translateX(0px)' }, { transform: 'translateX(100px)' },
  ] }, spring())
  return <div class="card spring-card" ref={motion}>Precompiled spring</div>
}

function NativeTargetsDemo() {
  const [position, setPosition] = createSignal(0), [angle, setAngle] = createSignal(0)
  const [mounted, mount] = createSignal(true)
  const [visible, show] = createSignal(false)
  return <section><h2>Reactive targets and springs</h2>
    <button onClick={() => setPosition(value => value === 0 ? 200 : 0)}>Move target</button>
    <button onClick={() => mount(value => !value)}>Unmount target</button>
    <button onClick={() => setAngle(value => value + 360)}>Rotate target</button>
    <Show when={mounted()}><ReactiveCard position={position()} angle={angle()} /></Show>
    <button onClick={() => show(value => !value)}>Toggle spring</button>
    <Lifecycle.Show when={visible()}><SpringCard /></Lifecycle.Show>
  </section>
}

function SequenceCard(props: { title: string; hold: boolean }) {
  const motion = createTransition(fadeScale, { duration: 900 })
  const { phase } = useLifecycle()
  return <>
    <div class="card sequence-card" ref={motion} data-name={props.title} data-phase={phase()}><strong>{props.title}</strong></div>
    <input aria-label="Sequence local state" />
    {props.hold && <ExitGate label="Release sequence work" />}
  </>
}

function SequenceDemo() {
  const [page, setPage] = createSignal('A'), [hold, setHold] = createSignal(false)
  return <section><h2>Out-in switch</h2>
    <p>The next branch appears when the outgoing animation finishes. Enable the hold to try waiting for other work too.</p>
    <label><input type="checkbox" checked={hold()} onChange={e => setHold(e.currentTarget.checked)} />Hold sequence exit</label>
    <nav>{['A', 'B', 'C', 'fallback'].map(name => <button onClick={() => setPage(name)}>Sequence {name}</button>)}</nav>
    <Lifecycle.Switch mode="out-in" fallback={<SequenceCard title="fallback" hold={hold()} />}>
      <Lifecycle.Match when={page() === 'A'}><SequenceCard title="A" hold={hold()} /></Lifecycle.Match>
      <Lifecycle.Match when={page() === 'B'}><SequenceCard title="B" hold={hold()} /></Lifecycle.Match>
      <Lifecycle.Match when={page() === 'C'}><SequenceCard title="C" hold={hold()} /></Lifecycle.Match>
    </Lifecycle.Switch>
  </section>
}

function Demo() {
  const [duration, setDuration] = createSignal(1000)
  const initialItems = [{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }, { id: 3, name: 'Gamma' }]
  const [items, setItems] = createSignal(initialItems)
  const [panel, setPanel] = createSignal(false)
  const [page, setPage] = createSignal('home')
  const [parent, setParent] = createSignal(true)
  const [child, setChild] = createSignal(true)
  const [separate, showSeparate] = createSignal(false)
  const [bidirectional, showBidirectional] = createSignal(false)
  return <main style={{ '--motion-duration': `${duration()}ms` }}>
    <h1>Solid 2 · Lifecycle</h1>
    <PostcardStudio />
    <ReadingQueue />
    <p>Cards glide in from the left and leave to the right. Type in one, remove it, then restore it mid-slide:
      it turns back without losing your text. Increase the card duration to see both movements in slow motion.</p>
    <label>Card duration: {duration()}ms <input aria-label="Card duration" type="range" min="500" max="5000" step="100" value={duration()} onInput={event => setDuration(+event.currentTarget.value)} /></label>
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
        <FlowCard title={`${index() + 1}. ${item().name}`} />
      }</Lifecycle.For>
    </section>

    <section><h2>Show</h2>
      <button onClick={() => setPanel(value => !value)}>Toggle panel</button>
      <Lifecycle.Show when={panel()}><FlowCard title="Panel" /></Lifecycle.Show>
    </section>

    <section><h2>Switch / Match</h2>
      <nav><button onClick={() => setPage('home')}>Home</button><button onClick={() => setPage('settings')}>Settings</button><button onClick={() => setPage('unknown')}>Fallback</button></nav>
      <Lifecycle.Switch fallback={<FlowCard title="Not found" />}>
        <Lifecycle.Match when={page() === 'home'}><FlowCard title="Home" /></Lifecycle.Match>
        <Lifecycle.Match when={page() === 'settings'}><FlowCard title="Settings" /></Lifecycle.Match>
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
    <LoadingMotionDemo />
    <NativeTargetsDemo />
    <SequenceDemo />

    <section><h2>Independent nested flows</h2>
      <p>Toggling the parent only animates the parent. The child has its own 350ms entrance and exit, even while the parent is leaving.</p>
      <nav><button onClick={() => setParent(value => !value)}>Toggle parent</button><button onClick={() => setChild(value => !value)}>Toggle child</button></nav>
      <Lifecycle.Show when={parent()}><FlowCard title="Parent">
        <Lifecycle.Show when={child()}><FlowCard title="Child" fast /></Lifecycle.Show>
      </FlowCard></Lifecycle.Show>
    </section>
  </main>
}

render(() => <Demo />, document.getElementById('app')!)
