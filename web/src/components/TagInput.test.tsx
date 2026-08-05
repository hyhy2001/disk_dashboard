import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TagInput } from './TagInput.js'

afterEach(cleanup)

function fireTab(input: HTMLInputElement): boolean {
  const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
  input.dispatchEvent(ev)
  return ev.defaultPrevented
}

describe('TagInput Tab handling', () => {
  it('commits the current term and prevents default when there is text', () => {
    const onChange = vi.fn()
    const { container } = render(<TagInput id="t" label="" placeholder="x" value="var" onChange={onChange} />)
    const input = container.querySelector('input')!

    const prevented = fireTab(input)

    expect(prevented).toBe(true)
    expect(onChange).toHaveBeenCalledWith('var, ')
  })

  it('lets Tab move focus on when the input is empty', () => {
    const onChange = vi.fn()
    const { container } = render(<TagInput id="t" label="" placeholder="x" value="" onChange={onChange} />)
    const input = container.querySelector('input')!

    const prevented = fireTab(input)

    expect(prevented).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })
})
