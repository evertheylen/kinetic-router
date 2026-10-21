import { children, type Accessor, type Element as SolidElement } from 'solid-js'
import { retain, type Selection } from './retain.js'

type ConditionalChildren<T> = SolidElement | ((value: Accessor<NonNullable<T>>) => SolidElement)

function conditional<T>(child: ConditionalChildren<T>, value: Accessor<NonNullable<T>>): SolidElement {
  return typeof child === 'function' && child.length > 0
    ? (child as (value: Accessor<NonNullable<T>>) => SolidElement)(value)
    : child as SolidElement
}

export interface ForProps<T> {
  each: readonly T[] | null | undefined | false
  by?: (item: T) => unknown
  children: (item: Accessor<T>, index: Accessor<number>) => SolidElement
}

export function For<T>(props: ForProps<T>): SolidElement {
  return retain(
    () => (props.each || []).map(value => ({ key: props.by ? props.by(value) : value, value })),
    props.children,
  )
}

export interface ShowProps<T> {
  when: T | null | undefined | false
  children: ConditionalChildren<T>
  fallback?: SolidElement
}

export function Show<T>(props: ShowProps<T>): SolidElement {
  const content = Symbol('content')
  const fallback = Symbol('fallback')
  return retain<NonNullable<T> | undefined>(
    () => {
      const value = props.when
      return value ? [{ key: content, value }] : [{ key: fallback, value: undefined }]
    },
    // The content key always has a truthy value, including its last exiting snapshot.
    value => value() !== undefined ? conditional(props.children, () => value()!) : props.fallback,
  )
}

const match = Symbol('Lifecycle.Match')
export interface MatchProps<T> {
  when: T | null | undefined | false
  children: ConditionalChildren<T>
}
interface MatchDescriptor {
  [match]: true
  props: MatchProps<unknown>
}

/** Like Solid's Match, this is a lazy descriptor; only Switch renders its children. */
export function Match<T>(props: MatchProps<T>): SolidElement {
  // SAFETY: JSX transports this descriptor to Switch; it is never rendered as DOM.
  return { [match]: true, props } as unknown as SolidElement
}

export interface SwitchProps {
  children: SolidElement
  fallback?: SolidElement
}

export function Switch(props: SwitchProps): SolidElement {
  const matches = children(() => props.children)
  const fallback = Symbol('fallback')
  type Branch = { descriptor: MatchDescriptor; value: NonNullable<unknown> } | undefined
  return retain<Branch>(() => {
    for (const child of matches.toArray()) {
      // SAFETY: the private tag below validates descriptors transported through JSX.
      const descriptor = child as unknown as MatchDescriptor
      if (!descriptor || descriptor[match] !== true) {
        throw new Error('Lifecycle.Switch only accepts Lifecycle.Match children')
      }
      const value = descriptor.props.when
      if (value) return [{ key: descriptor, value: { descriptor, value } }]
    }
    return [{ key: fallback, value: undefined }] satisfies Selection<Branch>[]
  }, branch => {
    const selected = branch()
    // Each descriptor has its own key; it cannot turn into a fallback or another Match.
    return selected
      ? conditional(selected.descriptor.props.children, () => branch()!.value)
      : props.fallback
  })
}
