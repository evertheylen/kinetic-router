import { Component, onCleanup, createSignal } from "solid-js";

export const Counter: Component = () => {
  const [count, setCount] = createSignal(0)
  const int = setInterval(() => setCount(i => i+1), 500);
  onCleanup(() => clearInterval(int));
  return <span>{count()%100}</span>
}
