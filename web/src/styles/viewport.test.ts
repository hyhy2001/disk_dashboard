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

      const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } })
      await page.goto(URL, { waitUntil: 'networkidle' })
      // The charts render after /api/overview resolves.
      await page.waitForSelector('.charts', { timeout: 15_000 })

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

  it('keeps all three chart panels visible in the viewport', async () => {
    if (!reachable || !browser) {
      console.warn(`skipped: ${URL} unreachable`)
      return
    }

    const page = await browser.newPage({ viewport: { width: 1440, height: 768 } })
    await page.goto(URL, { waitUntil: 'networkidle' })
    await page.waitForSelector('.charts .panel', { timeout: 15_000 })

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
