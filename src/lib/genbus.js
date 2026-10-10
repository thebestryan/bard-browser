/**
 * Generation bus — detached AI tasks that keep running across navigation.
 *
 * Any component can hand a promise to runDetached(); the promise continues
 * even after the component unmounts, and the UI shows a live "generating"
 * indicator plus completion toasts via subscribe().
 */

const listeners = new Set();
const tasks = new Map(); // id -> { id, label }
let counter = 0;

export const genbus = {
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  emit(event) {
    listeners.forEach((fn) => {
      try { fn(event); } catch { /* listener errors never break the bus */ }
    });
  },
  start(label) {
    const id = `task_${++counter}`;
    tasks.set(id, { id, label });
    this.emit({ type: "start", id, label });
    return id;
  },
  done(id, ok = true, detail = "") {
    const task = tasks.get(id);
    tasks.delete(id);
    this.emit({ type: "done", id, ok, label: task?.label || "", detail });
  },
  active() {
    return [...tasks.values()];
  },
};

/**
 * Run a detached generation task. Returns the underlying promise so
 * mounted callers can still await it for local UI, but nothing aborts
 * the task when the caller unmounts.
 */
export function runDetached(label, promise) {
  const taskId = genbus.start(label);
  Promise.resolve(promise)
    .then(() => genbus.done(taskId, true))
    .catch((e) => genbus.done(taskId, false, String(e?.message || e)));
  return promise;
}
