import { createSignal } from "solid-js";
import { Lifecycle, useLifecycle } from "@kinetic-router/lifecycle";
import { createCssTransition, createTransition } from "@kinetic-router/animations";
import "./todos.css";

type Todo = { id: number; title: string; emoji: string };

const demoTasks: Todo[] = [
  { id: 1, title: "Teach the rubber duck TypeScript", emoji: "🦆" },
  { id: 2, title: "Water the emotional support cactus", emoji: "🌵" },
  { id: 3, title: "Deploy absolutely nothing on Friday", emoji: "🚀" },
  { id: 4, title: "Celebrate this extremely productive list", emoji: "🪩" },
];

function TodoCard(props: { todo: Todo; complete: () => void }) {
  const { phase } = useLifecycle();
  const space = createCssTransition({
    apply: (element, direction) => { element.dataset.space = direction; },
    properties: ["grid-template-rows"],
  });
  // A single timeline tumbles in and reverses on exit (or a quick Undo).
  const motion = createTransition({ inout: [
    { opacity: 0, transform: "translateY(90px) rotate(-18deg) scale(0.45)" },
    { opacity: 1, transform: "translateY(-12px) rotate(4deg) scale(1.04)", offset: 0.65 },
    { opacity: 1, transform: "translateY(4px) rotate(-2deg) scale(0.98)", offset: 0.82 },
    { opacity: 1, transform: "translateY(0) rotate(0) scale(1)" },
  ] }, { duration: 1000, easing: "ease-out" });
  return <li class="todo-slot todos-space" ref={space} data-phase={phase()}
    inert={phase() === "exiting"} aria-hidden={phase() === "exiting" ? "true" : "false"}>
    <div class="todos-content"><div class="todo-card" ref={motion}>
      <span class="todo-emoji" aria-hidden="true">{props.todo.emoji}</span>
      <div class="todo-copy">
        <span class="todos-eyebrow">MISSION {String(props.todo.id).padStart(2, "0")}</span>
        <h2>{props.todo.title}</h2>
        <input aria-label={`Victory note for ${props.todo.title}`} placeholder="Victory note (survives a quick Undo)" />
      </div>
      <button class="todo-done" onClick={() => props.complete()} aria-label={`Complete ${props.todo.title}`}>
        <span aria-hidden="true">✓</span> Done!
      </button>
    </div></div>
  </li>;
}

function Victory() {
  const { phase } = useLifecycle();
  const space = createCssTransition({
    apply: (element, direction) => { element.dataset.space = direction; },
    properties: ["grid-template-rows"],
  });
  const motion = createTransition({ inout: [
    { opacity: 0, transform: "translateY(60px) rotate(-12deg) scale(0.3)" },
    { opacity: 1, transform: "translateY(-12px) rotate(3deg) scale(1.08)", offset: 0.7 },
    { opacity: 1, transform: "translateY(0) rotate(0) scale(1)" },
  ] }, { duration: 1200, easing: "ease-out" });
  return <div class="todos-victory-slot todos-space" ref={space} data-phase={phase()}
    aria-hidden={phase() === "exiting" ? "true" : "false"} inert={phase() === "exiting"}>
    <div class="todos-content"><section class="todos-victory" ref={motion} aria-labelledby="todos-victory-title">
      <div class="todos-confetti" aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => <span style={{
          "--piece": index,
          "--drift": `${index % 2 ? 90 : -90}px`,
        }} />)}
      </div>
      <span class="todos-trophy" aria-hidden="true">🏆</span>
      <p class="todos-eyebrow">Achievement unlocked</p>
      <h2 id="todos-victory-title">All done. All glory.</h2>
      <p>You have defeated the list. Take a bow, hydrate, tell the cactus.</p>
      <code>Lifecycle.Show → a very necessary celebration</code>
    </section></div>
  </div>;
}

function Todos() {
  const [tasks, setTasks] = createSignal(demoTasks);
  const [undo, setUndo] = createSignal<Todo[]>();
  let nextId = demoTasks.length + 1;
  let input!: HTMLInputElement;

  function complete(id?: number) {
    if (!tasks().length) return;
    // Retained rows must not keep keyboard focus as they become inert.
    input.focus();
    setUndo(tasks());
    setTasks(current => id === undefined ? [] : current.filter(todo => todo.id !== id));
  }

  return <section class="todos" aria-labelledby="todos-title">
    <header class="todos-header">
      <p class="todos-eyebrow">Lifecycle playground · ordinary tasks, extraordinary drama</p>
      <h1 id="todos-title">TODO <span aria-hidden="true">→</span> TA-DA!</h1>
      <p>A wildly unnecessary amount of animation for a perfectly ordinary list.</p>
    </header>
    <form class="todos-form" onSubmit={event => {
      event.preventDefault();
      const title = input.value.trim();
      if (!title) return;
      setTasks(current => [...current, { id: nextId++, title, emoji: "✨" }]);
      setUndo(undefined);
      input.value = "";
      input.focus();
    }}>
      <label for="todo-title">Your next very important mission</label>
      <div><input id="todo-title" ref={input} name="task" required maxlength={160} placeholder="e.g. Give the houseplants a pep talk" />
        <button type="submit">Add a little drama <span aria-hidden="true">✦</span></button></div>
    </form>
    <div class="todos-toolbar">
      <p role="status">{tasks().length ? `${tasks().length} ${tasks().length === 1 ? "mission" : "missions"} remaining` : "Zero tasks. Maximum glory."}</p>
      <div>
        <button disabled={!undo()} onClick={() => {
          const previous = undo();
          if (!previous) return;
          input.focus();
          setTasks(previous);
          setUndo(undefined);
        }}>Undo</button>
        <button disabled={!tasks().length} onClick={() => complete()}>Complete all</button>
        <button onClick={() => { input.focus(); setTasks(demoTasks); setUndo(undefined); }}>Reload demo</button>
      </div>
    </div>
    <div class="todos-stage">
      <ul class="todos-list" aria-label="Tasks">
        <Lifecycle.For each={tasks()} by={todo => todo.id}>
          {todo => <TodoCard todo={todo()} complete={() => complete(todo().id)} />}
        </Lifecycle.For>
      </ul>
      <Lifecycle.Show when={tasks().length === 0}><Victory /></Lifecycle.Show>
    </div>
    <p class="todos-hint"><code>Lifecycle.For</code> keeps exiting cards alive. Hit Undo mid-tumble to reverse
      the same animation and keep your victory note. Complete all to meet <code>Lifecycle.Show</code>.
      Native CSS wrappers ease the space open and closed alongside the tumbling cards.
      All motion respects reduced motion.</p>
  </section>;
}

export default {
  untrackedKeys: [],
  async render() {
    return () => ({ html: <Todos />, title: "Todos · TA-DA!", description: "A lifecycle animation playground" });
  },
};
