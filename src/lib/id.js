/**
 * Collision-resistant id. crypto.randomUUID needs a secure context, so fall
 * back to getRandomValues (available everywhere) rather than Math.random.
 * Lives outside store.jsx so lib/ modules don't pull in React.
 */
export const uid = () =>
  crypto.randomUUID?.() ??
  Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
