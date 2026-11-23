# Coming from Motion for React

If you know Motion's [`motion` components](https://motion.dev/docs/react-motion-component)
and [`AnimatePresence`](https://motion.dev/docs/react-animate-presence), the prop
names will look familiar. The main change is where you declare what is present:

```tsx
import { AnimatePresence, motion } from '@kinetic-router/animations'

<AnimatePresence when={open()}>
  <motion.section
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0, rotate: tilted() ? -5 : 0 }}
    exit={{ opacity: 0, y: 12 }}
    transition={{ duration: 0.2, ease: 'easeOut' }}
  >Preview</motion.section>
</AnimatePresence>
```

- **Use plain target objects instead of variants.** Read Solid signals in
  `animate` to change the pose. Targets take finite scalar `opacity` (0–1),
  `x`/`y` (pixels), `rotate` (degrees), and `scale`. `initial` and `exit` can
  override just part of the pose; omit `initial` or set it to `false` to skip entry.
- **Move the condition to `when`.** When `when` is truthy, the Solid boundary
  shows its content; when it becomes false, the boundary retains it for exit.
  It does not diff children. An ordinary conditional inside it still unmounts
  its own content immediately. For keyed lists, use `Lifecycle.For` with a stable
  key such as `by={item => item.id}`; see [Keyed For](../lifecycle/demo/main.tsx).
- **Undo before removal to keep local state.** Reopening a still-retained branch
  keeps the same node and retargets from the displayed pose, not necessarily by
  reversing the same animation timeline. The
  [Postcard studio](../lifecycle/demo/postcard-studio.tsx) demonstrates this with
  a draft input: move focus outside the outgoing content before making it inert,
  and keep Undo reachable.
- **Keep the timing units straight.** Component `duration` and `delay` are in
  seconds; `ease` takes CSS easing or names like `easeOut`. Legacy ref helpers
  such as `createAnimation` and `createTransition` still use milliseconds.

The components use browser-native interpolation. There is no drag, layout
animation, or per-frame JavaScript engine.
