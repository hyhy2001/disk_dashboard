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
