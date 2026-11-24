import { afterEach, expect, it, vi } from 'vitest'
import { createContext, createMemo, createSignal, Errored, Loading, onCleanup, onSettled, useContext } from 'solid-js'
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
        return <li><button onClick={() => setCount(count => count + 1)}>
          {context}:{item().label}:{index()}:{count()}
        </button></li>
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

it('reports a static parent on the first structural change, not on mount', async () => {
  const [items, setItems] = createSignal(['a'])
  const host = mount(() => <Errored fallback={error => <p>{String(error())}</p>}><ul style="position: static">
    <LayoutList each={items()}>{item => <li>{item()}</li>}</LayoutList>
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
