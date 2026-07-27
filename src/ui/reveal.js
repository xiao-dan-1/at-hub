export function createRevealRegistry({
  delay = 10_000,
  interval = 1000,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  const active = new Map();

  function hide(key) {
    const record = active.get(key);
    if (!record) return false;
    clearIntervalFn(record.intervalId);
    clearTimeoutFn(record.timeoutId);
    active.delete(key);
    record.onHide();
    return true;
  }

  function show(key, { onTick, onHide }) {
    hide(key);
    let remaining = Math.ceil(delay / interval);
    onTick(remaining);
    const intervalId = setIntervalFn(() => {
      remaining = Math.max(0, remaining - 1);
      onTick(remaining);
    }, interval);
    const timeoutId = setTimeoutFn(() => hide(key), delay);
    active.set(key, { intervalId, timeoutId, onHide });
  }

  function clear() {
    for (const key of [...active.keys()]) hide(key);
  }

  return { clear, hide, show };
}
