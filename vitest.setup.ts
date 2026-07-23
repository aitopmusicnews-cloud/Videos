// In-memory localStorage shim. Node 22 ships an experimental Web Storage
// API that's hooked up before test environments load and breaks the
// zustand persist middleware's setItem path; happy-dom doesn't override
// it cleanly. Easier to define our own — tests don't care about cross-test
// persistence.
const memStore = new Map<string, string>();
const localStorageShim: Storage = {
  get length() {
    return memStore.size;
  },
  clear: () => memStore.clear(),
  getItem: (k: string) => memStore.get(k) ?? null,
  key: (i: number) => Array.from(memStore.keys())[i] ?? null,
  removeItem: (k: string) => {
    memStore.delete(k);
  },
  setItem: (k: string, v: string) => {
    memStore.set(k, v);
  },
};
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageShim,
  writable: true,
  configurable: true,
});
