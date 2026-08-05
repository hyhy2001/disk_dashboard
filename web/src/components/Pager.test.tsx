import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { NumberPager, StepPager } from './Pager.js'

afterEach(cleanup)

describe('NumberPager', () => {
  it('gives the current page a visible selected style distinct from other pages', () => {
    const { getByRole } = render(<NumberPager page={3} pageCount={5} onGo={() => {}} />)
    const current = getByRole('button', { name: '3' })
    const other = getByRole('button', { name: '1' })
    expect(current.className).not.toBe(other.className)
    expect(current.className).toContain('bg-muted')
  })

  it('exposes the current page via aria-current', () => {
    const { getByRole } = render(<NumberPager page={3} pageCount={5} onGo={() => {}} />)
    expect(getByRole('button', { name: '3' }).getAttribute('aria-current')).toBe('page')
    expect(getByRole('button', { name: '1' }).getAttribute('aria-current')).toBeNull()
  })
})

describe('StepPager', () => {
  it('renders nothing when there is nowhere to step', () => {
    const { container } = render(
      <StepPager page={1} hasPrev={false} hasNext={false} onPrev={() => {}} onNext={() => {}} />,
    )
    expect(container.firstChild).toBeNull()
  })
})
