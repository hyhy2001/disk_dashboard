// Copy to clipboard, with a toast for the outcome.
//
// Paths are long and truncated on screen, so copying is how a viewer actually uses
// one — they paste it into a shell. The feedback has to be explicit: a click that
// silently may or may not have copied is worse than no feature.

import { failure, success } from './toast.js'

/**
 * Copy text, reporting through a toast either way.
 *
 * navigator.clipboard needs a secure context, which a dashboard served over plain
 * HTTP on an internal network does not have. The textarea fallback covers that —
 * document.execCommand('copy') is deprecated but still the only option there.
 */
export async function copyPath(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else if (!legacyCopy(text)) {
      throw new Error('Clipboard is unavailable in this context')
    }
    success('Path copied', text)
    return true
  } catch (err) {
    failure('Could not copy', err instanceof Error ? err.message : String(err))
    return false
  }
}

/** execCommand fallback for non-secure contexts. Returns whether it worked. */
function legacyCopy(text: string): boolean {
  const area = document.createElement('textarea')
  area.value = text
  // Off-screen but focusable: a hidden element cannot be selected.
  area.style.position = 'fixed'
  area.style.top = '-1000px'
  area.setAttribute('readonly', 'readonly')
  document.body.appendChild(area)
  try {
    area.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(area)
  }
}
