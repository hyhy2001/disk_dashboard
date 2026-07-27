// Every class the components use must have a rule in the stylesheet.
//
// This exists because deleting a CSS section with a regex once ate the .panel
// rules along with the intended ones: typecheck passed, tests passed, and the
// page rendered as unstyled boxes. A missing class is invisible to TypeScript,
// so it needs its own check.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = new URL('..', import.meta.url).pathname
const CSS = join(SRC, 'styles/app.css')

/**
 * Classes deliberately without their own rule: they exist as JSX hooks or inherit
 * everything from a parent selector. Listed explicitly so an accidental omission
 * still fails.
 */
const NO_RULE_NEEDED = new Set([
  'treemap', // wrapper only
  'ent__icon--file', // colour comes from .ent__icon
  'ent__size-val', // inherits from .ent__size-text
  'tile', // hook for .tile--open / .tile__rect; no styles of its own
])

/**
 * Whether the stylesheet declares `.name` at the top level.
 *
 * Nested rules inside `@container` / `@media` are excluded on purpose: those are
 * overrides for one breakpoint, so a class defined *only* there has no base
 * styling at all. Counting them is what let a deleted `.panels` rule slip past an
 * earlier version of this check.
 */
function isDefined(css: string, name: string): boolean {
  const escaped = name.replace(/-/g, '\\-')
  // Strip the body of every at-rule block, leaving top-level declarations.
  const topLevel = css.replace(/@(?:container|media|supports)[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, '')
  return new RegExp(`\\.${escaped}[\\s,{:.\\[>]`).test(topLevel)
}

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      tsxFiles(full, out)
    } else if (entry.endsWith('.tsx')) {
      out.push(full)
    }
  }
  return out
}

/** Class names from static className="..." attributes. */
function usedClasses(): Map<string, string> {
  const found = new Map<string, string>()
  for (const file of tsxFiles(SRC)) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(/className="([^"{]+)"/g)) {
      for (const name of (m[1] ?? '').split(/\s+/)) {
        if (name && !found.has(name)) found.set(name, file.slice(SRC.length))
      }
    }
    // Template-literal classNames: `panel${x ? ' panel--loading' : ''}` — pick out
    // the literal fragments, which is where a typo would otherwise hide.
    for (const m of text.matchAll(/className=\{`([^`]+)`\}/g)) {
      // A modifier can be split across the boundary — `delta__badge--${dir}`
      // leaves a dangling `delta__badge--`. Drop fragments ending in `-`, since
      // the real class name only exists at runtime.
      const literal = (m[1] ?? '').replace(/\$\{[^}]*\}/g, ' ')
      for (const name of literal.split(/\s+/).filter((n) => !n.endsWith('-'))) {
        if (name && !found.has(name)) found.set(name, file.slice(SRC.length))
      }
    }
  }
  return found
}

describe('stylesheet coverage', () => {
  const css = readFileSync(CSS, 'utf8')

  it('defines a rule for every class the components use', () => {
    const missing: string[] = []
    for (const [name, file] of usedClasses()) {
      if (NO_RULE_NEEDED.has(name)) continue
      if (!isDefined(css, name)) missing.push(`.${name} (used in ${file})`)
    }

    expect(missing).toEqual([])
  })

  it('keeps the layout classes the shell depends on', () => {
    // These carry the whole page structure; losing one silently degrades every
    // view rather than breaking one component.
    for (const name of ['app', 'main', 'sidebar', 'diskcol', 'panel', 'panels', 'glass', 'mesh']) {
      expect(css, `.${name} must be defined`).toMatch(new RegExp(`\\.${name}[\\s,{:]`))
    }
  })

  it('has no empty rule blocks left by editing', () => {
    expect(css).not.toMatch(/\{\s*\}/)
  })
})
