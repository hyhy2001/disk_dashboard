import { cleanup, fireEvent, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { useFocusTrap } from './useFocusTrap.js'

afterEach(cleanup)

function Harness(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref)
  return (
    <>
      <button>Before</button>
      <div ref={ref} tabIndex={-1}>
        <button>First</button>
        <button>Middle</button>
        <button>Last</button>
      </div>
      <button>After</button>
    </>
  )
}

describe('useFocusTrap', () => {
  it('moves Tab focus from outside into the first focusable element', () => {
    const { getByText, getByRole } = render(<Harness />)
    getByText('Before').focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(getByRole('button', { name: 'First' }))
  })

  it('wraps Tab from the last element back to the first', () => {
    const { getByRole } = render(<Harness />)
    const last = getByRole('button', { name: 'Last' })
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(getByRole('button', { name: 'First' }))
  })

  it('wraps Shift+Tab from the first element back to the last', () => {
    const { getByRole } = render(<Harness />)
    const first = getByRole('button', { name: 'First' })
    first.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(getByRole('button', { name: 'Last' }))
  })

  it('lets Tab move normally between elements inside the trap', () => {
    const { getByRole } = render(<Harness />)
    const first = getByRole('button', { name: 'First' })
    first.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(getByRole('button', { name: 'Middle' }))
  })
})
