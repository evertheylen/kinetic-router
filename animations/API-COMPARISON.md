# Coming from Motion for React

The `initial`, `animate`, `exit`, and `transition` props will look familiar from
[Motion for React](https://motion.dev/docs/react-motion-component). Instead of
React's [`AnimatePresence`](https://motion.dev/docs/react-animate-presence), use
the Solid lifecycle control that owns the condition, list, or branch:

```tsx
import { motion } from '@kinetic-router/animations'
import { Lifecycle as Lc } from '@kinetic-router/lifecycle'

<Lc.Show when={open()}>
  <motion.section
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0, rotate: tilted() ? -5 : 0 }}
    exit={{ opacity: 0, y: 12 }}
    transition={{ duration: 0.2, ease: 'easeOut' }}
  >Preview</motion.section>
</Lc.Show>
```

- **Use plain target objects instead of variants.** Read Solid signals in
  `animate` to change the pose. Targets take finite scalar `opacity` (0–1),
  `x`/`y` (pixels), `rotate` (degrees), and `scale`. `initial` and `exit` can
  override just part of the pose; omit `initial` or set it to `false` to skip entry.
- **Move the condition to `when`.** When `when` is truthy, the Solid boundary
  shows its content; when it becomes false, the boundary retains it for exit.
  It does not diff children. An ordinary conditional inside it still unmounts
  its own content immediately. For keyed lists, use `Lc.For` with a stable key
  such as `by={item => item.id}`. For mutually exclusive branches, use
  `Lc.Switch`/`Lc.Match`. See the [control flow examples](../lifecycle/demo/main.tsx).
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
