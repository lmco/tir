const chains = new Map<string, Promise<unknown>>();

export function withQueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  const settled = run.then(
    () => {},
    () => {},
  );
  chains.set(key, settled);
  settled.then(() => {
    if (chains.get(key) === settled) chains.delete(key);
  });
  return run;
}
