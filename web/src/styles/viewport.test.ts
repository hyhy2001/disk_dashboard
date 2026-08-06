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

/** `URL` above shadows the global, so paths are joined by hand. */
function absolute(path: string): string {
  return URL.replace(/\/+$/, '') + path
}

/** Laptop through desktop. 700 is the shortest viewport we claim to support. */
const VIEWPORTS = [
  { w: 1280, h: 560, name: '1280x560 (short window)' },
  { w: 1440, h: 700, name: '1440x700 (short laptop)' },
  { w: 1440, h: 768, name: '1440x768 (laptop)' },
  { w: 1680, h: 900, name: '1680x900' },
  { w: 1920, h: 1080, name: '1920x1080' },
]

/** Disk cards carry data-tooltip; the column header buttons do not. */
const DISK_CARD = '.diskcol button[data-tooltip]'

/** Tab label to its URL segment, for the deep-link path openTab takes below `lg`. */
const TAB_SLUGS: Record<string, string> = {
  Treemap: 'treemap',
  History: 'history',
  Users: 'detail-user',
  Perms: 'permissions',
  Inodes: 'inodes',
}

let browser: Browser | null = null
let reachable = false
/** First disk's route segments, discovered once from the API. See diskPath(). */
let firstDisk: { space: string; slug: string } | null = null

/**
 * Path to the first disk on the machine, for viewports that cannot click a card.
 *
 * The click-through navigation below is the preferred route because it exercises
 * what a user does, but the disk column is `hidden lg:block` — below 1024px there
 * is no card to click, and a phone-width test would time out waiting for one. So
 * narrow viewports deep-link instead, using whatever targets actually exist rather
 * than a hardcoded slug.
 */
async function diskPath(page: import('playwright').Page, suffix: string): Promise<string> {
  if (!firstDisk) {
    const res = await page.request.get(absolute('/api/groups'))
    const body = (await res.json()) as { data: { name: string; targets: { slug: string }[] }[] }
    const group = body.data.find((g) => g.targets.length > 0)
    if (!group?.targets[0]) throw new Error('no disks with reports on this machine')
    firstDisk = { space: group.name, slug: group.targets[0].slug }
  }
  return `/${encodeURIComponent(firstDisk.space)}/${encodeURIComponent(firstDisk.slug)}/${suffix}`
}

/**
 * Open a page showing a disk's Overview.
 *
 * The root URL lands on the space comparison view, because a space with no disk
 * chosen has nothing else useful to show. So these tests navigate: load the shell,
 * then click the first disk card. Clicking rather than constructing a URL keeps
 * the test independent of which targets happen to exist on the machine. Below the
 * `lg` breakpoint the column that holds those cards is hidden, so there the route
 * is deep-linked instead — see diskPath.
 */
async function openOverview(width: number, height: number): Promise<import('playwright').Page> {
  if (!browser) throw new Error('browser not launched')
  const page = await browser.newPage({ viewport: { width, height } })
  await page.goto(URL, { waitUntil: 'networkidle' })

  if (width >= 1024) {
    await page.waitForSelector(DISK_CARD, { timeout: 15_000 })
    await page.click(DISK_CARD)
  } else {
    await page.goto(absolute(await diskPath(page, 'overview')), { waitUntil: 'networkidle' })
  }

  await page.waitForSelector('.main svg.chart', { timeout: 15_000 })
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
    await page.waitForSelector('.main svg.chart text', { timeout: 15_000 })

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
          panel: (svg.closest('div.rounded-lg')?.querySelector('h2')?.textContent ?? '?') as string,
          rendered: Math.round(declared * (box.width / vb.width) * 10) / 10,
        })
      }
      return out
    })
    await page.close()

    expect(sizes.length).toBeGreaterThan(1)
    // The chart axis text is declared at 12px; two panels rendering the same
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
      for (const panel of document.querySelectorAll('.main .grid > div.rounded-lg')) {
        const r = panel.getBoundingClientRect()
        const title = panel.querySelector('h2')?.textContent ?? '?'
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

/*
 * Chart axis labels must be legible, not merely present.
 *
 * Both Overview charts sized their axis from the data rather than from the pixels
 * they had. The timeline drew one label per point up to eight, so on a 320px phone
 * six dates merged into one run of digits ("07/2907/3007/31…"); the user chart
 * always drew five size ticks, which overlapped by 30px of their 48px width. The
 * timeline's first date was also centred on the plot's left edge, so half of it sat
 * at a negative x and the svg's overflow:hidden clipped it — "07/29" rendered as
 * "7/29" at every width, desktop included.
 *
 * A DOM-shape assertion cannot see any of this: the <text> nodes are all present
 * and correctly positioned per their own attributes. Only their painted boxes
 * overlap, so the check has to be geometric.
 */
describe('chart axis labels stay legible', () => {
  for (const [w, h] of [
    [320, 568],
    [360, 640],
    [390, 844],
    [430, 932],
    [768, 1024],
    [1440, 900],
  ] as const) {
    it(`neither overlap nor clip at ${w}x${h}`, async () => {
      if (!reachable || !browser) {
        console.warn(`skipped: ${URL} unreachable`)
        return
      }

      const page = await openOverview(w, h)

      const problems = await page.evaluate(() => {
        const bad: string[] = []
        for (const svg of document.querySelectorAll('.main svg')) {
          const box = svg.getBoundingClientRect()
          // Skip decorative glyphs and anything too small to carry an axis.
          if (box.width < 40) continue

          // Clipped by the svg's own overflow:hidden.
          for (const text of svg.querySelectorAll('text')) {
            const r = text.getBoundingClientRect()
            if (r.width === 0) continue
            if (box.left - r.left > 0.5) bad.push(`«${text.textContent}» cut off at the left edge`)
            if (r.right - box.right > 0.5) bad.push(`«${text.textContent}» cut off at the right edge`)
          }

          // Painted on top of a neighbour. Labels on the same axis share a
          // baseline, so an overlap needs both a vertical and a horizontal one.
          const labels = [...svg.querySelectorAll('.chart__axis')]
            .map((t) => ({ text: t.textContent ?? '', r: t.getBoundingClientRect() }))
            .filter((l) => l.r.width > 0)
          labels.sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left)
          for (let i = 1; i < labels.length; i += 1) {
            const prev = labels[i - 1]
            const cur = labels[i]
            if (!prev || !cur) continue
            const vertical = Math.min(prev.r.bottom, cur.r.bottom) - Math.max(prev.r.top, cur.r.top)
            const horizontal = Math.min(prev.r.right, cur.r.right) - Math.max(prev.r.left, cur.r.left)
            if (vertical > 1 && horizontal > 0.5) {
              bad.push(`«${prev.text}» and «${cur.text}» overlap by ${Math.round(horizontal)}px`)
            }
          }
        }
        return [...new Set(bad)]
      })
      await page.close()

      expect(problems, `axis label problems: ${problems.join('; ')}`).toEqual([])
    }, 45_000)
  }

  it('keeps the first and last date, and thins the rest, on a narrow plot', async () => {
    if (!reachable || !browser) {
      console.warn(`skipped: ${URL} unreachable`)
      return
    }

    const page = await openOverview(320, 568)
    const dates = await page.evaluate(() => {
      const chart = document.querySelector('.main svg.chart')
      return [...(chart?.querySelectorAll('.chart__axis') ?? [])]
        .map((t) => t.textContent ?? '')
        .filter((t) => t.includes('/'))
    })
    await page.close()

    // Thinning must not empty the axis: a chart with no dates on it is as
    // useless as one whose dates are illegible.
    expect(dates.length, 'the timeline should still be labelled at 320px').toBeGreaterThanOrEqual(2)
  }, 45_000)
})

/*
 * Panel titles must be readable, not just unclipped.
 *
 * "Capacity Over Time" shared a flex row with the range picker and the expand
 * button, which are sized first, so at 320px it was left 49px of the 78px it
 * needed — and with no `truncate` it reflowed to three lines and was still cut.
 * Adding truncate alone turned it into "Ca…", which passes an overflow check
 * while telling the reader nothing, so below sm the title takes its own row.
 */
describe('Overview panel titles are readable', () => {
  for (const [w, h] of [
    [320, 568],
    [390, 844],
    [768, 1024],
  ] as const) {
    it(`shows each panel title in full at ${w}x${h}`, async () => {
      if (!reachable || !browser) {
        console.warn(`skipped: ${URL} unreachable`)
        return
      }

      const page = await openOverview(w, h)
      const titles = await page.evaluate(() =>
        [...document.querySelectorAll('.main .grid > div.rounded-lg h2')].map((h) => ({
          text: h.textContent?.trim() ?? '',
          shown: h.clientWidth,
          needed: h.scrollWidth,
          height: h.getBoundingClientRect().height,
        })),
      )
      await page.close()

      expect(titles.length, 'Overview should have three titled panels').toBe(3)
      for (const title of titles) {
        expect(title.needed - title.shown, `«${title.text}» is truncated at ${w}px`).toBeLessThanOrEqual(1)
        // One line at the 14px title size is ~20px; three lines was the old bug.
        expect(title.height, `«${title.text}» wraps to multiple lines at ${w}px`).toBeLessThan(30)
      }
    }, 45_000)
  }
})

/*
 * Nothing may be pushed off the right edge of the screen.
 *
 * The capacity strip was five fixed-size figures in a flex row, so its width was
 * whatever its contents needed: on a 390px phone "Free" and "Usage" laid out past
 * x=390 and no scroll container could reach them, which reads as the dashboard
 * simply not having those numbers. That class of bug is invisible to a desktop-only
 * suite and to any unit test, so it is measured here at phone widths.
 */
describe('nothing lands off the right edge', () => {
  const NARROW = [
    { w: 320, h: 640, name: '320x640' },
    { w: 360, h: 640, name: '360x640' },
    { w: 390, h: 844, name: '390x844' },
    { w: 768, h: 1024, name: '768x1024' },
  ]

  for (const vp of NARROW) {
    it(`shows all five capacity figures at ${vp.name}`, async () => {
      if (!reachable || !browser) {
        console.warn(`skipped: ${URL} unreachable`)
        return
      }

      const page = await openOverview(vp.w, vp.h)
      // The count-up animation only moves the digits, not the boxes, but let it
      // finish so a mid-animation width cannot be what is measured.
      await page.waitForTimeout(1400)

      const stats = await page.evaluate(() => {
        const out: { label: string; right: number; visible: boolean }[] = []
        for (const el of document.querySelectorAll('div')) {
          if (el.children.length > 0) continue
          const label = (el.textContent ?? '').trim()
          if (!/^(Total|Used|Scanned|Free|Usage)$/i.test(label)) continue
          const r = el.getBoundingClientRect()
          out.push({ label, right: Math.round(r.right), visible: r.right <= window.innerWidth + 1 && r.left >= -1 })
        }
        return out
      })
      await page.close()

      expect(stats).toHaveLength(5)
      const hidden = stats.filter((s) => !s.visible)
      expect(hidden, `off-screen capacity figures: ${JSON.stringify(hidden)}`).toEqual([])
    }, 45_000)

    it(`does not scroll horizontally at ${vp.name}`, async () => {
      if (!reachable || !browser) {
        console.warn(`skipped: ${URL} unreachable`)
        return
      }

      const page = await openOverview(vp.w, vp.h)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      await page.close()

      expect(overflow, `the page scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(2)
    }, 45_000)
  }
})

/*
 * The disk cards' four capacity figures must not be clipped.
 *
 * The column is user-resizable from 200px, and at its 260px default a four-column
 * grid gives each cell 48px — narrower than both "110 GB" (52px) and the word
 * "Scanned" (58px), so every card silently truncated its own numbers at every
 * viewport width, desktop included. `truncate` makes that failure look deliberate,
 * which is why it needs measuring rather than eyeballing.
 */
describe('disk card figures are not clipped', () => {
  for (const [w, h] of [
    [1280, 800],
    [1920, 1080],
  ] as const) {
    it(`fits every card figure at ${w}x${h}`, async () => {
      if (!reachable || !browser) {
        console.warn(`skipped: ${URL} unreachable`)
        return
      }

      const page = await browser.newPage({ viewport: { width: w, height: h } })
      await page.goto(URL, { waitUntil: 'networkidle' })
      await page.waitForSelector(DISK_CARD, { timeout: 15_000 })
      await page.waitForTimeout(600)

      const clipped = await page.evaluate(() => {
        const bad: string[] = []
        for (const el of document.querySelectorAll('.diskcol p, .diskcol span')) {
          // sr-only text is clipped on purpose — it is sized to 1px by design.
          if (el.classList.contains('sr-only') || el.children.length > 0) continue
          // So is anything carrying `truncate`: the size · files · dirs cells give
          // ground with an ellipsis so the row stays one line tall, and the same
          // figures are spelled out in full in the Total/Used/Scanned/Free grid.
          // What this test is for is text cut off with no ellipsis and no fallback.
          if (getComputedStyle(el).textOverflow === 'ellipsis') continue
          if (el.scrollWidth > el.clientWidth + 1) {
            bad.push(`«${(el.textContent ?? '').trim()}» needs ${el.scrollWidth}px, has ${el.clientWidth}px`)
          }
        }
        return bad
      })
      await page.close()

      expect(clipped, `clipped disk card text: ${clipped.join('; ')}`).toEqual([])
    }, 45_000)
  }
})

/*
 * The disk column is user-resizable (200–640px), and the suite above only ever
 * measured it at its 260px default. Three bugs lived in that blind spot: the
 * space title collapsed to 0px wide at the 200px minimum, the size/files/dirs
 * meta row wrapped onto a second line below ~340px, and the 640px ceiling was
 * absolute, so on a 1024px window a fully dragged column left the main panel
 * 128px. All three are width-of-the-column bugs, not width-of-the-screen bugs,
 * which is why no viewport-only test could see them.
 */
describe('disk column survives its own resize range', () => {
  for (const width of [200, 240, 300, 360, 480, 640] as const) {
    it(`keeps the header and card rows intact at ${width}px`, async () => {
      if (!reachable || !browser) {
        console.warn(`skipped: ${URL} unreachable`)
        return
      }

      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
      await page.goto(URL, { waitUntil: 'networkidle' })
      await page.waitForSelector(DISK_CARD, { timeout: 15_000 })

      const shape = await page.evaluate(async (colWidth) => {
        document.documentElement.style.setProperty('--col2-width', `${colWidth}px`)
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
        const column = document.querySelector('.diskcol')
        const title = column?.querySelector('h2')
        const card = column?.querySelector('.overflow-auto > button')
        // The size · files · dirs row: one line tall at every width, because each
        // cell truncates rather than the row reflowing.
        const meta = card?.querySelector('.tabular-nums')
        if (!column || !title || !card || !meta) return null
        const box = column.getBoundingClientRect()
        return {
          titleWidth: title.getBoundingClientRect().width,
          metaHeight: meta.getBoundingClientRect().height,
          cardOverflowRight: card.getBoundingClientRect().right - box.right,
        }
      }, width)
      await page.close()

      expect(shape, 'disk column, title, card and meta row should all be present').not.toBeNull()
      // The space name is the column's only label for which group is shown; at the
      // 200px minimum, sharing a row with the 145px sort select squeezed it to 0.
      expect(shape!.titleWidth, `space title width at ${width}px`).toBeGreaterThan(40)
      // Two lines is ~36px; one line is ~18px.
      expect(shape!.metaHeight, `meta row height at ${width}px`).toBeLessThan(28)
      expect(shape!.cardOverflowRight, `card overflow past the column at ${width}px`).toBeLessThanOrEqual(1)
    }, 45_000)
  }
})

/*
 * The column's ceiling has to leave the main panel usable. A hard 640px maximum
 * meant a 1024px window could be dragged down to 128px of charts and tables, and
 * a width chosen on a large monitor persisted into a small one. The effective
 * maximum is therefore viewport-dependent, and the applied width re-clamps on
 * resize while the stored preference stays put.
 */
describe('disk column resize ceiling leaves the main panel usable', () => {
  for (const [w, h] of [
    [1024, 600],
    [1152, 700],
    [1280, 720],
    [1920, 1080],
  ] as const) {
    it(`keeps main at least 360px wide when dragged to the maximum at ${w}x${h}`, async () => {
      if (!reachable || !browser) {
        console.warn(`skipped: ${URL} unreachable`)
        return
      }

      const page = await browser.newPage({ viewport: { width: w, height: h } })
      await page.goto(URL, { waitUntil: 'networkidle' })
      // Below 1280px the shell auto-collapses the sidebar, which hides the disk
      // column entirely; expand it so there is a column to resize. Matched on the
      // accessible label rather than on the glyph inside: the button's content is
      // an icon, and keying a test to it would break on any icon change.
      await page.evaluate(() => {
        const toggle = document.querySelector('aside button[aria-label="Expand sidebar"]')
        if (toggle instanceof HTMLElement) toggle.click()
      })
      await page.waitForSelector(DISK_CARD, { timeout: 15_000 })

      // Drive the handle the way a keyboard user would rather than writing the CSS
      // variable, so the clamp under test is the one that actually runs.
      await page.focus('[role="separator"]')
      for (let i = 0; i < 60; i += 1) await page.keyboard.press('Shift+ArrowRight')
      await page.waitForTimeout(200)

      const geometry = await page.evaluate(() => {
        const main = document.querySelector('.main')?.getBoundingClientRect()
        const column = document.querySelector('.diskcol')?.getBoundingClientRect()
        if (!main || !column) return null
        return {
          mainWidth: main.width,
          columnWidth: column.width,
          horizontalScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }
      })
      await page.close()

      expect(geometry, 'main and disk column should both be present').not.toBeNull()
      expect(geometry!.mainWidth, `main panel width at ${w}x${h}`).toBeGreaterThanOrEqual(359)
      expect(geometry!.columnWidth, 'column should not exceed its 640px ceiling').toBeLessThanOrEqual(641)
      expect(geometry!.horizontalScroll, 'a maxed column should not scroll the page sideways').toBeLessThanOrEqual(1)
    }, 45_000)
  }
})

/*
 * Treemap tile labels must render at the size they declare.
 *
 * The canvas was a fixed 900x460 viewBox scaled to fit its box, which scaled the
 * text with it: the same 13px label rendered at 5px on a phone and 30px on a wide
 * monitor. Tying height to width also made the canvas 472px tall on a 1440x700
 * laptop and pushed the page into a scroll. Both are measured, because a viewBox
 * mistake produces a perfectly valid-looking DOM.
 */
describe('treemap canvas scales with its box', () => {
  const SIZES = [
    [390, 844],
    [1440, 700],
    [1920, 1080],
    [2560, 1440],
  ] as const

  for (const [w, h] of SIZES) {
    it(`renders tile labels at 13px and stays on screen at ${w}x${h}`, async () => {
      if (!reachable || !browser) {
        console.warn(`skipped: ${URL} unreachable`)
        return
      }

      const page = await openTab('Treemap', 'input[aria-label="Search this disk"]', w, h)
      await page.click('.main button[aria-pressed]:text-is("Treemap")')
      await page.waitForSelector('.treemap__svg', { timeout: 15_000 })
      await page.waitForTimeout(900)

      const geo = await page.evaluate(() => {
        const svg = document.querySelector('.treemap__svg')
        if (!(svg instanceof SVGSVGElement)) return null
        const box = svg.getBoundingClientRect()
        const vb = svg.viewBox.baseVal
        const text = svg.querySelector('text')
        const declared = text ? parseFloat(getComputedStyle(text).fontSize) : 0
        const scale = vb.width > 0 ? box.width / vb.width : 0
        return {
          rendered: Math.round(declared * scale * 10) / 10,
          belowFold: Math.round(Math.max(0, box.bottom - window.innerHeight)),
        }
      })
      await page.close()

      expect(geo).not.toBeNull()
      // Scale 1 means a declared 13px label is 13px on screen at every width.
      expect(geo!.rendered, `tile labels render at ${geo!.rendered}px`).toBeCloseTo(13, 0)
      expect(geo!.belowFold, `canvas extends ${geo!.belowFold}px below the fold`).toBeLessThanOrEqual(2)
    }, 60_000)
  }
})

/*
 * Every control must be big enough to hit.
 *
 * WCAG 2.5.8 asks for 24x24 CSS px. Two controls sat under it — the sync pill's
 * refresh button at 24x16 and the breadcrumb copy button at 20x20 — both because
 * they hold only a small icon and were sized to it rather than to a target.
 */
describe('touch targets meet the 24px minimum', () => {
  it('has no control smaller than 24x24 on a phone', async () => {
    if (!reachable || !browser) {
      console.warn(`skipped: ${URL} unreachable`)
      return
    }

    const page = await openTab('Treemap', 'input[aria-label="Search this disk"]', 390, 844)
    const small = await page.evaluate(() => {
      const out: string[] = []
      for (const el of document.querySelectorAll('button, a[href], input, [role="tab"]')) {
        const r = el.getBoundingClientRect()
        // Skip anything not currently rendered: an off-canvas drawer's contents
        // are not a target until it is open.
        if (r.width === 0 || r.height === 0 || r.right < 0) continue
        if (r.width < 24 || r.height < 24) {
          const name = el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 24)
          out.push(`«${name}» is ${Math.round(r.width)}x${Math.round(r.height)}`)
        }
      }
      return out
    })
    await page.close()

    expect(small, `undersized controls: ${small.join('; ')}`).toEqual([])
  }, 45_000)

  it('keeps the Detail tab bar on one row down to 320px', async () => {
    if (!reachable || !browser) {
      console.warn(`skipped: ${URL} unreachable`)
      return
    }

    const page = await openTab('Treemap', 'input[aria-label="Search this disk"]', 320, 640)
    const rows = await page.evaluate(() => {
      const nav = document.querySelector('.main nav[role="tablist"]')
      if (!nav) return null
      // Tabs wrapping to a second line show up as more than one distinct top edge.
      return new Set([...nav.children].map((c) => Math.round(c.getBoundingClientRect().top))).size
    })
    await page.close()

    expect(rows).not.toBeNull()
    expect(rows, `the tab bar wrapped onto ${rows} rows`).toBe(1)
  }, 45_000)
})

/**
 * Open a Detail sub-tab and wait for its content.
 *
 * Same navigation reason as openOverview: the root URL shows the space comparison,
 * so a disk has to be picked before a Detail tab exists — and the same breakpoint
 * caveat, so below `lg` the route is deep-linked rather than clicked.
 */
async function openTab(tab: string, ready: string, width: number, height: number): Promise<import('playwright').Page> {
  if (!browser) throw new Error('browser not launched')
  const page = await browser.newPage({ viewport: { width, height } })
  await page.goto(URL, { waitUntil: 'networkidle' })

  if (width >= 1024) {
    await page.waitForSelector(DISK_CARD, { timeout: 15_000 })
    await page.click(DISK_CARD)
    // Picking a disk lands on Overview by design, so the Detail page comes first —
    // the sub-tabs do not exist until it is open.
    await page.click('header nav[role="tablist"] button:text-is("Detail")')
    await page.click(`.main nav[role="tablist"] button:text-is("${tab}")`)
  } else {
    const slug = TAB_SLUGS[tab]
    if (slug === undefined) throw new Error(`no route slug known for the ${tab} tab`)
    await page.goto(absolute(await diskPath(page, `detail/${slug}`)), { waitUntil: 'networkidle' })
  }

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
    { tab: 'Treemap', ready: 'input[aria-label="Search this disk"]' },
    { tab: 'Users', ready: 'h2:text-is("Top directories")' },
    { tab: 'Perms', ready: 'div[class*="divide-border/50"], p:text-is("No permission issues")' },
    { tab: 'Inodes', ready: 'h2:text-is("System inodes")' },
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
    await page.waitForSelector(DISK_CARD, { timeout: 15_000 })
    await page.click(DISK_CARD)
    await page.click('header nav[role="tablist"] button:text-is("Detail")')
    await page.click('.main nav[role="tablist"] button:text-is("Users")')
    await page.waitForSelector('h2:text-is("Top directories")', { timeout: 15_000 })
    await page.waitForTimeout(2000)
    await page.close()

    // A feedback loop shows up as two different limits for one steady viewport.
    expect(limits.length).toBeGreaterThan(0)
    expect(new Set(limits).size, `page size oscillated: ${limits.join(', ')}`).toBe(1)
  }, 45_000)

  /*
   * Search belongs to the TreeMap tab, not the page header.
   *
   * It only controls the treemap, so a header placement showed it on tabs where
   * picking a hit silently switched tab, and spent scarce header height on a per-tab
   * control. Moving it beside the breadcrumb then exposed a second bug: the list
   * panel below has its own stacking context and swallowed clicks on the dropdown.
   * Both are asserted here because neither is visible to a type or unit check.
   */
  it('keeps the tree search inside the TreeMap tab', async () => {
    if (!reachable || !browser) {
      console.warn(`skipped: ${URL} unreachable`)
      return
    }

    const page = await openTab('Treemap', 'input[aria-label="Search this disk"]', 1600, 900)
    const placement = await page.evaluate(() => {
      const search = document.querySelector('input[aria-label="Search this disk"]')
      if (!search) return null
      return {
        inHeader: document.querySelector('header input[aria-label="Search this disk"]') !== null,
        inMain: document.querySelector('.main input[aria-label="Search this disk"]') !== null,
      }
    })

    // And gone from a tab it does not drive.
    await page.click('.main nav[role="tablist"] button:text-is("History")')
    await page.waitForTimeout(400)
    const onOtherTab = await page.evaluate(
      () => document.querySelector('input[aria-label="Search this disk"]') !== null,
    )
    await page.close()

    expect(placement).not.toBeNull()
    expect(placement!.inHeader, 'search must not live in the page header').toBe(false)
    expect(placement!.inMain, 'search should live inside the main content').toBe(true)
    expect(onOtherTab, 'search should not appear on the History tab').toBe(false)
  }, 45_000)

  it('lets the search dropdown be clicked above the list panel', async () => {
    if (!reachable || !browser) {
      console.warn(`skipped: ${URL} unreachable`)
      return
    }

    const page = await openTab('Treemap', 'input[aria-label="Search this disk"]', 1600, 900)
    await page.fill('input[aria-label="Search this disk"]', 'lib')
    await page.waitForSelector('div.fixed.z-50 li button', { timeout: 15_000 })

    const before = await page.evaluate(
      () => document.querySelectorAll('nav[aria-label="Directory path"] button').length,
    )
    // A real click, not dispatchEvent: the bug was the panel intercepting pointer
    // events, which a synthetic event would sail straight past.
    await page.click('div.fixed.z-50 li button >> nth=0', { timeout: 10_000 })
    await page.waitForTimeout(1200)

    const after = await page.evaluate(() => ({
      crumbs: document.querySelectorAll('nav[aria-label="Directory path"] button').length,
      path: location.pathname,
    }))
    await page.close()

    expect(after.crumbs, 'picking a hit should descend into the tree').toBeGreaterThan(before)
    expect(after.path, 'the jump should stay on the treemap tab').toContain('treemap')
  }, 45_000)

  /*
   * Note on the Inodes tab: it appears in the no-overflow loop above but not in the
   * two tests below, and that is correct rather than an omission. Those two are
   * about a measured page size — the request asking for the right number of rows —
   * and the Inodes tab has none: every account arrives in one bounded payload and
   * CSS decides what is on screen. Removing its containment does fail the
   * no-overflow test (verified: 860px at 1440x700), so that tab's layout is
   * covered by the loop alone.
   */

  it('asks for more rows on a taller viewport', async () => {
    if (!reachable || !browser) {
      console.warn(`skipped: ${URL} unreachable`)
      return
    }

    const rowsAt = async (height: number): Promise<number> => {
      const page = await openTab('Users', 'h2:text-is("Top directories")', 1600, height)
      const n = await page.evaluate(() => {
        const list = document.querySelectorAll('ul[class*="divide-border/30"]')[0]
        return list ? list.querySelectorAll('li').length : 0
      })
      await page.close()
      return n
    }

    const short = await rowsAt(700)
    const tall = await rowsAt(1080)

    // The point of measuring: a fixed page size would return the same count for both.
    expect(short).toBeGreaterThan(0)
    expect(tall, `expected more rows at 1080px (${tall}) than at 700px (${short})`).toBeGreaterThan(short)
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
    await page.waitForSelector('div[role="separator"]', { timeout: 15_000 })

    const geo = await page.evaluate(() => {
      const handle = document.querySelector('div[role="separator"]')?.getBoundingClientRect()
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
    await page.waitForSelector(DISK_CARD, { timeout: 15_000 })

    // Set the width variable directly rather than driving the menu: this is a layout
    // assertion, and going through the UI would also be testing the menu. Collapse
    // is now a CSS variable on the shell root, so the class-based set is gone. The
    // shell is the div holding the --sidebar-width variable, not the toast host.
    const gaps = await page.evaluate(async () => {
      const root = document.querySelector('div[style*="--sidebar-width"]')
      if (root instanceof HTMLElement) root.style.setProperty('--sidebar-width', '56px')
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const sidebar = document.querySelector('aside')?.getBoundingClientRect()
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
