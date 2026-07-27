// Overview must fit one screen without scrolling.
//
// This is the requirement legacy meets with its clamp()-based canvas heights, and
// the only way to check it is to lay the page out in a real browser: the total
// depends on font metrics, wrapping and flex behaviour that no amount of arithmetic
// over the stylesheet can predict.
//
// Runs against the deployed dashboard. Skipped when it is unreachable, so the
// suite still passes on a machine without the server running.

import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const URL = process.env.DASHBOARD_URL ?? 'https://dashboard.hydev.me/'

/** Laptop through desktop. 700 is the shortest viewport we claim to support. */
const VIEWPORTS = [
  { w: 1440, h: 700, name: '1440x700 (short laptop)' },
  { w: 1440, h: 768, name: '1440x768 (laptop)' },
  { w: 1680, h: 900, name: '1680x900' },
  { w: 1920, h: 1080, name: '1920x1080' },
]

let browser: Browser | null = null
let reachable = false

/**
 * Open a page showing a disk's Overview.
 *
 * The root URL lands on the space comparison view, because a space with no disk
 * chosen has nothing else useful to show. So these tests navigate: load the shell,
 * then click the first disk card. Clicking rather than constructing a hash keeps
 * the test independent of which targets happen to exist on the machine.
 */
async function openOverview(width: number, height: number): Promise<import('playwright').Page> {
  if (!browser) throw new Error('browser not launched')
  const page = await browser.newPage({ viewport: { width, height } })
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForSelector('.disk', { timeout: 15_000 })
  await page.click('.disk')
  await page.waitForSelector('.charts', { timeout: 15_000 })
  // Let ResizeObserver deliver the first measurement before anything is measured.
  await page.waitForTimeout(500)
  return page
}

beforeAll(async () => {
  try {
    browser = await chromium.launch({ args: ['--no-sandbox'] })
    const page = await browser.newPage()
    const res = await page.goto(URL, { timeout: 15_000 })
    reachable = res !== null && res.ok()
    await page.close()
  } catch {
    reachable = false
  }
}, 60_000)

afterAll(async () => {
  await browser?.close()
})

describe('Overview fits one viewport', () => {
  for (const vp of VIEWPORTS) {
    it(`does not scroll at ${vp.name}`, async () => {
      if (!reachable || !browser) {
        console.warn(`skipped: ${URL} unreachable`)
        return
      }

      const page = await openOverview(vp.w, vp.h)

      const metrics = await page.evaluate(() => {
        const main = document.querySelector('.main')
        if (!main) return null
        return {
          scrollHeight: main.scrollHeight,
          clientHeight: main.clientHeight,
          bodyOverflow: document.body.scrollHeight - window.innerHeight,
        }
      })
      await page.close()

      expect(metrics).not.toBeNull()
      // A couple of pixels of rounding is not a scrollbar.
      expect(
        metrics!.scrollHeight - metrics!.clientHeight,
        `main overflows by ${metrics!.scrollHeight - metrics!.clientHeight}px`,
      ).toBeLessThanOrEqual(2)
      expect(metrics!.bodyOverflow, 'page itself must not scroll').toBeLessThanOrEqual(2)
    }, 45_000)
  }

  it('renders chart text at the same size in every panel', async () => {
    if (!reachable || !browser) {
      console.warn(`skipped: ${URL} unreachable`)
      return
    }

    const page = await openOverview(1440, 768)
    await page.waitForSelector('svg.chart text', { timeout: 15_000 })

    const sizes = await page.evaluate(() => {
      const out: { panel: string; rendered: number }[] = []
      for (const svg of document.querySelectorAll('svg.chart')) {
        const vb = (svg as SVGSVGElement).viewBox.baseVal
        const box = svg.getBoundingClientRect()
        const text = svg.querySelector('text')
        if (!text || vb.width === 0 || box.width === 0) continue
        // A scaled viewBox scales its text too, so the on-screen size is the
        // declared size times the scale factor.
        const declared = parseFloat(getComputedStyle(text).fontSize)
        out.push({
          panel: svg.closest('.panel')?.querySelector('.panel__title')?.textContent ?? '?',
          rendered: Math.round(declared * (box.width / vb.width) * 10) / 10,
        })
      }
      return out
    })
    await page.close()

    expect(sizes.length).toBeGreaterThan(1)
    // Legacy uses one size across all charts; two panels rendering the same
    // declared size differently is the bug this guards.
    const distinct = [...new Set(sizes.map((s) => s.rendered))]
    expect(distinct, `mismatched chart text: ${JSON.stringify(sizes)}`).toHaveLength(1)
    expect(distinct[0]).toBeCloseTo(12, 0)
  }, 45_000)

  it('keeps all three chart panels visible in the viewport', async () => {
    if (!reachable || !browser) {
      console.warn(`skipped: ${URL} unreachable`)
      return
    }

    const page = await openOverview(1440, 768)

    const offscreen = await page.evaluate(() => {
      const bad: string[] = []
      for (const panel of document.querySelectorAll('.charts .panel')) {
        const r = panel.getBoundingClientRect()
        const title = panel.querySelector('.panel__title')?.textContent ?? '?'
        if (r.bottom > window.innerHeight + 2) {
          bad.push(`${title} extends ${Math.round(r.bottom - window.innerHeight)}px below the fold`)
        }
      }
      return bad
    })
    await page.close()

    expect(offscreen).toEqual([])
  }, 45_000)
})

/**
 * Open a Detail sub-tab and wait for its content.
 *
 * Same navigation reason as openOverview: the root URL shows the space comparison,
 * so a disk has to be picked before a Detail tab exists.
 */
async function openTab(
  tab: string,
  ready: string,
  width: number,
  height: number,
): Promise<import('playwright').Page> {
  if (!browser) throw new Error('browser not launched')
  const page = await browser.newPage({ viewport: { width, height } })
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForSelector('.disk', { timeout: 15_000 })
  await page.click('.disk')
  // Picking a disk lands on Overview by design, so the Detail page comes first —
  // the sub-tabs do not exist until it is open.
  await page.click('.tab:text-is("Detail")')
  await page.click(`.subtab:text-is("${tab}")`)
  await page.waitForSelector(ready, { timeout: 15_000 })
  // Let the fit measurement settle and its page land.
  await page.waitForTimeout(1200)
  return page
}

/*
 * The list tabs must fit one screen.
 *
 * They page against a measured row count rather than a fixed one, because a fixed
 * page size is either too tall for a laptop or wastes half a desktop. That
 * measurement is easy to get wrong in ways nothing else catches: an early version
 * measured the list's own container, whose height depends on the rows in it, and
 * oscillated between a 21-row and a 6-row page. Another left the Detail User tab
 * stuck on its skeleton forever, because the measured element does not exist on the
 * first render and a plain effect only ever saw a null ref.
 *
 * So these tests assert the two things that actually matter — the page does not
 * scroll, and the list settles on one page size — at both extremes of the supported
 * viewport range.
 */
describe('list tabs fit one viewport', () => {
  const TABS = [
    { tab: 'TreeMap', ready: '.ent__rows' },
    { tab: 'Detail User', ready: '.ud__body' },
    { tab: 'Permission Issues', ready: '.perm__body' },
  ]

  for (const { tab, ready } of TABS) {
    for (const [w, h] of [
      [1440, 700],
      [1920, 1080],
    ] as const) {
      it(`does not scroll the page on ${tab} at ${w}x${h}`, async () => {
        if (!reachable || !browser) {
          console.warn(`skipped: ${URL} unreachable`)
          return
        }

        const page = await openTab(tab, ready, w, h)
        const overflow = await page.evaluate(() => {
          const main = document.querySelector('.main')
          if (!main) return null
          return main.scrollHeight - main.clientHeight
        })
        await page.close()

        expect(overflow).not.toBeNull()
        expect(overflow, `${tab} overflows the page by ${overflow}px`).toBeLessThanOrEqual(2)
      }, 45_000)
    }
  }

  it('settles on one page size instead of oscillating', async () => {
    if (!reachable || !browser) {
      console.warn(`skipped: ${URL} unreachable`)
      return
    }

    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
    const limits: string[] = []
    // Only /api/detail: the treemap tab renders first and its own (correct, smaller)
    // limit would otherwise look like an oscillation here.
    page.on('request', (req) => {
      const m = /\/api\/detail\/[^?]*\?.*limit=(\d+)/.exec(req.url())
      if (m?.[1]) limits.push(m[1])
    })

    await page.goto(URL, { waitUntil: 'networkidle' })
    await page.waitForSelector('.disk', { timeout: 15_000 })
    await page.click('.disk')
    await page.click('.tab:text-is("Detail")')
    await page.click('.subtab:text-is("Detail User")')
    await page.waitForSelector('.ud__body', { timeout: 15_000 })
    await page.waitForTimeout(2000)
    await page.close()

    // A feedback loop shows up as two different limits for one steady viewport.
    expect(limits.length).toBeGreaterThan(0)
    expect(new Set(limits).size, `page size oscillated: ${limits.join(', ')}`).toBe(1)
  }, 45_000)

  it('asks for more rows on a taller viewport', async () => {
    if (!reachable || !browser) {
      console.warn(`skipped: ${URL} unreachable`)
      return
    }

    const rowsAt = async (height: number): Promise<number> => {
      const page = await openTab('Detail User', '.ud__body', 1600, height)
      const n = await page.evaluate(
        () => document.querySelectorAll('.ud__list:first-of-type .ud__row').length,
      )
      await page.close()
      return n
    }

    const short = await rowsAt(700)
    const tall = await rowsAt(1080)

    // The point of measuring: a fixed page size would return the same count for both.
    expect(short).toBeGreaterThan(0)
    expect(tall, `expected more rows at 1080px (${tall}) than at 700px (${short})`).toBeGreaterThan(
      short,
    )
  }, 60_000)
})

// The three-column shell positions both nav columns with `position: fixed`, so
// every seam between them is computed arithmetic over CSS variables rather than
// flex flow. Two bugs came from exactly that and neither was visible to a unit
// test: the resize handle laid out at x=0 instead of at the column edge, and
// collapsing the sidebar left a hole because only .sidebar's width changed while
// .diskcol's `left` still pointed at the old --sidebar-width.
describe('three-column shell geometry', () => {
  it('puts the resize handle on the disk column edge', async () => {
    if (!reachable || !browser) {
      console.warn(`skipped: ${URL} unreachable`)
      return
    }

    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
    await page.goto(URL, { waitUntil: 'networkidle' })
    await page.waitForSelector('.resizer', { timeout: 15_000 })

    const geo = await page.evaluate(() => {
      const handle = document.querySelector('.resizer')?.getBoundingClientRect()
      const column = document.querySelector('.diskcol')?.getBoundingClientRect()
      if (!handle || !column) return null
      return { handleLeft: handle.left, handleWidth: handle.width, columnRight: column.right }
    })
    await page.close()

    expect(geo).not.toBeNull()
    // The handle must straddle the seam, not sit somewhere else entirely.
    const distance = Math.abs(geo!.handleLeft + geo!.handleWidth / 2 - geo!.columnRight)
    expect(distance, `handle centre is ${Math.round(distance)}px from the column edge`).toBeLessThanOrEqual(6)
  }, 45_000)

  it('leaves no gap between the columns when the sidebar is collapsed', async () => {
    if (!reachable || !browser) {
      console.warn(`skipped: ${URL} unreachable`)
      return
    }

    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
    await page.goto(URL, { waitUntil: 'networkidle' })
    await page.waitForSelector('.diskcol', { timeout: 15_000 })

    // Set the class directly rather than driving the menu: this is a layout
    // assertion, and going through the UI would also be testing the menu.
    const gaps = await page.evaluate(async () => {
      document.body.classList.add('sidebar-collapsed')
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect()
      const column = document.querySelector('.diskcol')?.getBoundingClientRect()
      const main = document.querySelector('.main')?.getBoundingClientRect()
      if (!sidebar || !column || !main) return null
      return {
        sidebarToColumn: column.left - sidebar.right,
        columnToMain: main.left - column.right,
        sidebarWidth: sidebar.width,
      }
    })
    await page.close()

    expect(gaps).not.toBeNull()
    expect(gaps!.sidebarWidth, 'sidebar should shrink when collapsed').toBeLessThan(100)
    expect(Math.abs(gaps!.sidebarToColumn), 'gap between sidebar and disk column').toBeLessThanOrEqual(2)
    expect(Math.abs(gaps!.columnToMain), 'gap between disk column and main').toBeLessThanOrEqual(2)
  }, 45_000)
})
