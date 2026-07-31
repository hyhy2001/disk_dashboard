// Browser APIs jsdom does not implement, stubbed for component tests.
//
// These are deliberately inert rather than simulated: jsdom performs no layout, so
// a fake ResizeObserver could only ever report zeros. Components must already cope
// with "not measured yet" for their first render, which is the state these tests
// exercise.

class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver ??= NoopResizeObserver

// jsdom implements Blob but not the object-URL registry around it, so the CSV
// download path has nothing to hand an <a download>. Defined as real functions so
// tests can spy on them; the values are never dereferenced.
URL.createObjectURL ??= (): string => 'blob:stub'
URL.revokeObjectURL ??= (): void => {}

// matchMedia is read for prefers-reduced-motion and theme preference.
globalThis.matchMedia ??= ((query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList) as typeof globalThis.matchMedia

// jsdom defaults to a 1024px window, which lands inside the sidebar auto-collapse
// band and would make the layout tests see a collapsed rail. Pretend we are on a
// wide desktop so the shell renders expanded, as it does on a real monitor. The
// setup runs for server tests too (Node, no `window`), so guard it.
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: 1600,
  })
  Object.defineProperty(window, 'outerWidth', {
    configurable: true,
    value: 1600,
  })
}
