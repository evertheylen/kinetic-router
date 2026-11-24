import { afterEach, expect, it, vi } from 'vitest'
import { createContext, createMemo, createSignal, Errored, flatten, Loading, onCleanup, onSettled, Show, useContext } from 'solid-js'
import { render } from '@solidjs/web'
import { onExit, useLifecycle } from '@kinetic-router/lifecycle'
import { LayoutList } from './layout-list.js'

const disposers: (() => void)[] = []
function mount(view: Parameters<typeof render>[0]) {
  const host = document.createElement('div')
  document.body.append(host)
  disposers.push(render(view, host))
  return host
}

function settle() { return new Promise<void>(resolve => onSettled(resolve)) }

afterEach(async () => {
  for (const dispose of disposers.splice(0)) dispose()
  document.body.replaceChildren()
  await settle()
  vi.restoreAllMocks()
})

it('runs keyed row setup once while item, index and local state stay reactive in its JSX', async () => {
  const [items, setItems] = createSignal([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }])
  const Context = createContext('outside')
  const setups: string[] = [], cleanups: string[] = []
  const host = mount(() => <Errored fallback={error => <p>{String(error())}</p>}>
    <Context value="inside"><ul style="position: relative">
      <LayoutList each={items()} by={item => item.id} transition={{ duration: 0 }}>{(item, index) => {
        const id = item().id, initialIndex = index()
        const context = useContext(Context)
        const [count, setCount] = createSignal(0)
        setups.push(`${id}:${initialIndex}`)
        onCleanup(() => { cleanups.push(id) })
        return <>{index() === 0 ? '' : false}<li><button onClick={() => setCount(count => count + 1)}>
          {context}:{item().label}:{index()}:{count()}
        </button></li>{index() === 0 ? true : null}</>
      }}</LayoutList>
    </ul></Context>
  </Errored>)
  await settle()
  const [a, b] = host.querySelectorAll('li')
  a!.querySelector('button')!.click()
  setItems([{ id: 'b', label: 'updated B' }, { id: 'a', label: 'updated A' }])
  await settle()
  const ordered = host.querySelectorAll('li')
  expect(ordered[0]).toBe(b)
  expect(ordered[1]).toBe(a)
  expect(a!.textContent).toBe('inside:updated A:1:1')
  expect(b!.textContent).toBe('inside:updated B:0:0')
  expect(setups).toEqual(['a:0', 'b:1'])
  expect(cleanups).toEqual([])
  setItems([])
  await vi.waitFor(() => expect(cleanups.sort()).toEqual(['a', 'b']))
})

it('waits for returned JSX to resolve and then rejects a replacement root', async () => {
  let release!: () => void
  const load = new Promise<void>(resolve => { release = resolve })
  const [replace, setReplace] = createSignal(false)
  const setup = vi.fn(() => {
    const first = <li>ready</li>, second = <li>replacement</li>
    const loaded = createMemo(() => load.then(() => first))
    return <>{replace() ? second : loaded()}</>
  })
  const host = mount(() => <Errored fallback={error => <p>{String(error())}</p>}>
    <Loading fallback={<span>loading</span>}><ul>
      <LayoutList each={['a']}>{setup}</LayoutList>
    </ul></Loading>
  </Errored>)
  try {
    await settle()
    expect(host.textContent).toBe('loading')
    release(); await settle()
    expect(host.textContent).toBe('ready')
    setReplace(true); await settle()
    expect(host.textContent).toContain('LayoutList row replaced its root')
    expect(setup).toHaveBeenCalledTimes(1)
  } finally { release(); await settle() }
})

it.each(['before detach', 'while detached'] as const)('keeps an independently held exit pinned when it starts %s', async starts => {
  const [items, setItems] = createSignal(['a', 'b', 'c'])
  let release!: () => void
  const hold = new Promise<void>(resolve => { release = resolve })
  const host = mount(() => <ul style="position: relative"><LayoutList each={items()}>{item => {
    const id = item()
    const { phase } = useLifecycle()
    if (id === 'a') onExit(() => hold)
    return <li data-phase={phase()}>{id}</li>
  }}</LayoutList></ul>)
  await settle()
  const list = host.querySelector('ul')!, a = list.querySelector('li')!
  const readBox = vi.spyOn(list, 'getBoundingClientRect')
  try {
    let originalPin: Animation | undefined
    if (starts === 'before detach') {
      setItems(['b', 'c']); await settle()
      originalPin = a.getAnimations()[0]!
      originalPin.finish()
      await originalPin.finished
    }
    list.remove()
    readBox.mockClear()
    setItems(['c', 'b']); await settle()
    expect(readBox).not.toHaveBeenCalled()
    host.append(list)
    expect(list.firstElementChild).toBe(a)
    expect(list.textContent).toBe('acb')
    expect(a.dataset.phase).toBe('exiting')
    const [pin] = a.getAnimations()
    if (originalPin) expect(pin).toBe(originalPin)
    expect(pin?.playState).toBe('finished')
    const endpoint = (pin!.effect as KeyframeEffect).getKeyframes().at(-1)
    expect(endpoint).toMatchObject({ position: 'absolute', opacity: '0' })
    if (starts === 'while detached') {
      expect(endpoint).not.toHaveProperty('top')
      expect(endpoint).not.toHaveProperty('left')
    }
    setItems(['c', 'a', 'b']); await settle()
    expect(list.children[1]).toBe(a)
    expect(a.dataset.phase).toBe('present')
    expect(a.getAnimations()).not.toContain(pin)

    setItems(['c', 'b']); await settle()
    for (const animation of a.getAnimations()) animation.finish()
    release()
    await vi.waitFor(() => expect(a.isConnected).toBe(false))
    expect(a.getAnimations()).toEqual([])
  } finally { release(); await settle() }
})

it('pins an independently held exit created while cached output has no parent', async () => {
  const [items, setItems] = createSignal(['a', 'b'])
  const [shown, show] = createSignal(true)
  let release!: () => void
  const hold = new Promise<void>(resolve => { release = resolve })
  const host = mount(() => {
    const output = <LayoutList each={items()}>{item => {
      if (item() === 'a') onExit(() => hold)
      return <li>{item()}</li>
    }}</LayoutList>
    // Keep the row owners alive even when Show stops inserting their output.
    const cached = createMemo(() => flatten(output), { sync: true })
    return <ul style="position: relative"><Show when={shown()}>{cached()}</Show></ul>
  })
  try {
    await settle()
    const list = host.querySelector('ul')!, a = list.querySelector('li')!
    const anchor = Array.from(list.childNodes).find(node => node.nodeValue === 'LayoutList')!
    show(false); await settle()
    expect(list.isConnected).toBe(true)
    expect(anchor.parentElement).toBeNull()
    expect(a.isConnected).toBe(false)
    setItems(['b']); await settle()
    show(true); await settle()

    expect(a.parentElement).toBe(list)
    const [pin] = a.getAnimations()
    expect(pin?.playState).toBe('finished')
    const endpoint = (pin!.effect as KeyframeEffect).getKeyframes().at(-1)
    expect(endpoint).toMatchObject({ position: 'absolute', opacity: '0' })
    expect(endpoint).not.toHaveProperty('top')
    release()
    await vi.waitFor(() => expect(list.textContent).toBe('b'))
    expect(a.getAnimations()).toEqual([])
  } finally { release(); await settle() }
})

it.each(['before the edit', 'during commit'] as const)('snaps when the parent loses its layout box %s', async hides => {
  const [items, setItems] = createSignal(['a'])
  const host = mount(() => <div><ul style="position: relative"><LayoutList each={items()}>{item => {
    if (item() === 'b' && hides === 'during commit') host.firstElementChild!.setAttribute('hidden', '')
    return <li>{item()}</li>
  }}</LayoutList></ul></div>)
  await settle()
  const ancestor = host.querySelector('div')!, list = host.querySelector('ul')!
  // Happy DOM returns a zero-sized rect even under a hidden ancestor.
  vi.spyOn(list, 'getClientRects').mockImplementation(() => ancestor.hidden ? [] as unknown as DOMRectList : [new DOMRect()] as unknown as DOMRectList)
  if (hides === 'before the edit') ancestor.hidden = true

  setItems(['b']); await settle()
  ancestor.hidden = false
  const b = Array.from(list.children).find(row => row.textContent === 'b')!
  expect(b.getAnimations()).toEqual([])
  expect(list.getAnimations()).toEqual([])
  await vi.waitFor(() => expect(list.textContent).toBe('b'))
})

it.each(['zero duration', 'reduced motion'] as const)('skips row measurement and keeps a held exit out of flow with %s', async mode => {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)')
  const matches = vi.spyOn(media, 'matches', 'get').mockReturnValue(mode === 'reduced motion')
  vi.spyOn(window, 'matchMedia').mockReturnValue(media)
  const [duration, setDuration] = createSignal(mode === 'zero duration' ? 0 : 0.25)
  const [items, setItems] = createSignal(['a', 'b'])
  let release!: () => void
  const hold = new Promise<void>(resolve => { release = resolve })
  const host = mount(() => <ul style="position: relative"><LayoutList each={items()} transition={{ duration: duration() }}>{item => {
    const { phase } = useLifecycle()
    if (item() === 'a') onExit(() => hold)
    return <li data-phase={phase()}>{item()}</li>
  }}</LayoutList></ul>)
  try {
    await settle()
    const list = host.querySelector('ul')!, [a, b] = list.querySelectorAll('li')
    // Model a real, zero-height box without Happy DOM's delegation to getBoundingClientRect.
    vi.spyOn(list, 'getClientRects').mockReturnValue([new DOMRect()] as unknown as DOMRectList)
    const readList = vi.spyOn(list, 'getBoundingClientRect')
    const readA = vi.spyOn(a!, 'getBoundingClientRect').mockImplementation(() =>
      new DOMRect(0, a!.dataset.phase === 'exiting' ? 45 : 10, 100, 20))
    const readB = vi.spyOn(b!, 'getBoundingClientRect')
    const style = vi.spyOn(window, 'getComputedStyle')
    setItems(['b']); await settle()
    for (const read of [readList, readA, readB]) expect(read).not.toHaveBeenCalled()
    expect(style.mock.calls.some(([node]) => node === a || node === b)).toBe(false)
    expect(a!.dataset.phase).toBe('exiting')
    const [pin] = a!.getAnimations()
    expect(pin?.playState).toBe('finished')
    const endpoint = (pin!.effect as KeyframeEffect).getKeyframes().at(-1)
    expect(endpoint).toMatchObject({ position: 'absolute', opacity: '0' })
    expect(endpoint).not.toHaveProperty('top')

    setDuration(0.25)
    matches.mockReturnValue(false)
    setItems(['b', 'a']); await settle()
    expect(list.children[1]).toBe(a)
    expect(a!.dataset.phase).toBe('present')
    expect(pin?.playState).toBe('idle')
    const [move] = a!.getAnimations()
    expect((move!.effect as KeyframeEffect).getKeyframes()[0]).not.toHaveProperty('translate')
  } finally { release(); await settle() }
})

it('animates supported rows when another row lacks WAAPI', async () => {
  const [items, setItems] = createSignal(['a', 'b'])
  const host = mount(() => <ul style="position: relative"><LayoutList each={items()}>
    {item => <li>{item()}</li>}
  </LayoutList></ul>)
  await settle()
  const list = host.querySelector('ul')!
  const [a, b] = list.querySelectorAll('li')
  Object.defineProperty(a!, 'animate', { value: undefined })
  for (const row of [a!, b!]) {
    vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() =>
      new DOMRect(0, list.firstElementChild === row ? 0 : 20, 100, 20))
  }

  setItems(['b', 'a']); await settle()
  expect(list.firstElementChild).toBe(b)
  expect(a!.getAnimations()).toEqual([])
  const moves = b!.getAnimations()
  expect(moves).toHaveLength(1)
  expect((moves[0]!.effect as KeyframeEffect).getKeyframes()).toMatchObject([
    { translate: '0px 20px' }, { translate: '0px 0px' },
  ])
})

it.each([0.25, 0])('reports a static parent on the first structural change with duration %s, not on mount', async duration => {
  const [items, setItems] = createSignal(['a'])
  const host = mount(() => <Errored fallback={error => <p>{String(error())}</p>}><ul style="position: static">
    <LayoutList each={items()} transition={{ duration }}>{item => <li>{item()}</li>}</LayoutList>
  </ul></Errored>)
  await settle()
  expect(host.textContent).toBe('a')
  setItems(['b']); await settle()
  expect(host.textContent).toContain('set position: relative on its parent')
})

it('rejects a non-number duration without coercion', async () => {
  const [items, setItems] = createSignal(['a'])
  const duration = { valueOf: vi.fn(() => 0.25) }
  const host = mount(() => <Errored fallback={error => <p>{String(error())}</p>}><ul style="position: relative">
    <LayoutList each={items()} transition={{ duration: duration as unknown as number }}>{item => <li>{item()}</li>}</LayoutList>
  </ul></Errored>)
  await settle()
  setItems(['b']); await settle()
  expect(host.textContent).toContain('duration must be finite non-negative seconds')
  expect(duration.valueOf).not.toHaveBeenCalled()
})

it.each(['duplicate keys', 'shared root'] as const)('rejects %s', async problem => {
  const root = document.createElement('li')
  const children = vi.fn(() => root)
  const host = mount(() => <Errored fallback={error => <p>{String(error())}</p>}><ul>
    <LayoutList each={problem === 'duplicate keys' ? ['a', 'a'] : ['a', 'b']}>{children}</LayoutList>
  </ul></Errored>)
  await settle()
  if (problem === 'duplicate keys') {
    expect(host.textContent).toContain('Lifecycle.For requires unique keys')
    expect(children).not.toHaveBeenCalled()
  } else {
    expect(host.textContent).toContain('LayoutList rows cannot share a root')
  }
})
