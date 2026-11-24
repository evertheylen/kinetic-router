import { children, untrack, type Accessor, type Element as SolidElement } from 'solid-js'
import { retain, type RetentionMode } from './retain.js'

type ConditionalChildren<T> = SolidElement | ((value: Accessor<NonNullable<T>>) => SolidElement)

function conditional<T>(child: ConditionalChildren<T>, value: Accessor<NonNullable<T>>): SolidElement {
  return typeof child === 'function' && child.length > 0
    ? untrack(() => child(value))
    : child as SolidElement
}

/**
 * Keys default to item identity and must be unique. Reorders, same-key replacement,
 * and reentry during exit preserve the instance; removal followed by entry does not.
 * Item/index are always accessors, unlike native Solid 2 For's default item mode.
 * Exiting rows retain their last selected values and previous rendered slots.
 * No For fallback is implemented.
 */
export interface ForProps<T> {
  each: readonly T[] | null | undefined | false
  by?: (item: T) => unknown
  /** Runs during committed rendering, before changing the selected keys or their
   * order. The previous rows are still rendered. Not called for initial rendering,
   * same-key value updates, or final disposal of an already-exiting row. Return
   * a callback to run after the latest change renders, before lifecycle handlers. */
  onBeforeChange?: () => void | (() => void)
  children: (item: Accessor<T>, index: Accessor<number>) => SolidElement
}

export function For<T>(props: ForProps<T>): SolidElement {
  const render = props.children
  return retain(
    () => (props.each || []).map(value => ({ key: props.by ? props.by(value) : value, value })),
    (item, index) => untrack(() => render(item, index)),
    undefined,
    props.onBeforeChange,
  )
}

/**
 * One content instance across truthy values; optional child callback gets an accessor.
 * Content and fallback are separate retained boundaries and may coexist during exit.
 * No keyed variant or out-in sequencing is implemented.
 */
export interface ShowProps<T> {
  when: T | null | undefined | false
  children: ConditionalChildren<T>
  fallback?: SolidElement
}

export function Show<T>(props: ShowProps<T>): SolidElement {
  return retain<NonNullable<T> | undefined>(() => {
    const value = props.when
    if (value) return [{ key: true, value }]
    return 'fallback' in props ? [{ key: false, value: undefined }] : []
  }, value => untrack(value) !== undefined ? conditional(props.children, () => value()!) : props.fallback)
}

const match = Symbol('Lifecycle.Match')
/** The selected branch's child callback receives an accessor, retaining its last value on exit. */
export interface MatchProps<T> {
  when: T | null | undefined | false
  children: ConditionalChildren<T>
}
interface MatchDescriptor<T = unknown> {
  [match]: true
  props: MatchProps<T>
}

/** Like Solid's Match, this is a lazy descriptor; only Switch renders its children. */
export function Match<T>(props: MatchProps<T>): SolidElement {
  const descriptor: MatchDescriptor<T> = { [match]: true, props }
  return descriptor
}

/**
 * Stable Match descriptors only; selects the first truthy branch.
 * Default parallel allows outgoing and incoming branches to coexist. Out-in waits
 * for all outgoing hooks AND owner disposal before mounting the latest selection
 * (including fallback). Intermediate selections never mount. Reselecting a still-
 * exiting branch aborts its exit and restores the same owner/state immediately.
 * Same-branch value updates do not start exits. Final unmount never mounts queued
 * content; nested boundaries remain independent and do not delay ancestor exits.
 */
export interface SwitchProps {
  children: SolidElement
  fallback?: SolidElement
  mode?: RetentionMode
}

export function Switch(props: SwitchProps): SolidElement {
  const matches = children(() => props.children)
  const fallback = Symbol('fallback')
  type Branch = { descriptor: MatchDescriptor; value: NonNullable<unknown> } | undefined
  return retain<Branch>(() => {
    for (const descriptor of matches.toArray()) {
      if (!isMatch(descriptor)) {
        throw new Error('Lifecycle.Switch only accepts Lifecycle.Match children')
      }
      const value = descriptor.props.when
      if (value) return [{ key: descriptor, value: { descriptor, value } }]
    }
    return 'fallback' in props ? [{ key: fallback, value: undefined }] : []
  }, branch => {
    const selected = untrack(branch)
    // Each descriptor has its own key; it cannot turn into a fallback or another Match.
    return selected
      ? conditional(selected.descriptor.props.children, () => branch()!.value)
      : props.fallback
  }, () => props.mode ?? 'parallel')
}

function isMatch(child: SolidElement): child is MatchDescriptor {
  return typeof child === 'object' && child !== null && match in child
}
