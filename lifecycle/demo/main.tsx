import { createSignal, onCleanup, untrack, type Element as SolidElement } from 'solid-js'
import { render } from '@solidjs/web'
import { Lifecycle, onEnter, onExit, onInOut, useLifecycle, type Direction } from '../src/index.js'
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
  let element!: HTMLDivElement
  const instance = untrack(mounts) + 1
  setMounts(instance)
  onCleanup(() => setDisposals(value => value + 1))
  const lifecycle = useLifecycle()
  const [clicks, setClicks] = createSignal(0)
  onExit(async ({ signal }) => {
    const milliseconds = props.fast ? 350 : duration()
    const animation = element.animate(
      [{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0.25, transform: 'translateX(12px)' }],
      { duration: milliseconds / 2, fill: 'forwards' },
    )
    const cancel = () => animation.cancel()
    signal.addEventListener('abort', cancel, { once: true })
    try {
      // Independent arbitrary async work, not just an animation-completion contract.
      await Promise.all([animation.finished, wait(milliseconds, signal)])
    } finally {
      signal.removeEventListener('abort', cancel)
      animation.cancel()
    }
  })
  return <div class="card" ref={element} data-phase={lifecycle.phase()}>
    <header><strong>{props.title}</strong><code>#{instance} · {lifecycle.phase()}</code></header>
    <label>Local state <input aria-label={`${props.title} state`} placeholder="Type; remove; restore before exit ends" /></label>
    <button onClick={() => setClicks(value => value + 1)}>Still interactive: {clicks()}</button>
    {props.children}
  </div>
}

// Only await this element's designated finite motion, not decorative animations.
function cssFinished(element: HTMLElement, direction: Direction, reversible: boolean) {
  return Promise.all(element.getAnimations().filter(animation => reversible
    ? animation instanceof CSSTransition && animation.transitionProperty === 'opacity'
    : animation instanceof CSSAnimation && animation.animationName === `lifecycle-${direction}`,
  ).map(animation => animation.finished))
}

function CssCard(props: { reversible: boolean }) {
  const reversible = untrack(() => props.reversible)
  const instance = untrack(mounts) + 1
  setMounts(instance)
  onCleanup(() => setDisposals(value => value + 1))
  const lifecycle = useLifecycle()
  const [runs, setRuns] = createSignal<Direction[]>([])
  const [clicks, setClicks] = createSignal(0)
  let element!: HTMLDivElement
  const motion = reversible ? onInOut<HTMLDivElement>({
    prepare(target, { direction }) { target.dataset.direction = direction },
    run({ element, direction }) {
      // Retarget CSS; aborting an old waiter must not reset the visual position.
      element.dataset.direction = direction
      setRuns(runs => [...runs, direction])
      return cssFinished(element, direction, true)
    },
  }) : onEnter<HTMLDivElement>({
    // The first keyframe applies before insertion, including the animation delay.
    prepare(target) { target.dataset.direction = 'in' },
    run({ element }) {
      element.dataset.direction = 'in'
      setRuns(runs => [...runs, 'in'])
      return cssFinished(element, 'in', false)
    },
  })
  if (!reversible) onExit(() => {
    element.dataset.direction = 'out'
    setRuns(runs => [...runs, 'out'])
    return cssFinished(element, 'out', false)
  })
  return <div
    class={`card ${reversible ? 'css-inout' : 'css-separate'}`}
    ref={target => { element = target; motion(target) }}
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
