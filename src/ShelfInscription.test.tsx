// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import ShelfInscription from './ShelfInscription'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('lets the reader confirm a Chinese IME candidate before binding the named book', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
  let time = 10
  vi.spyOn(performance, 'now').mockImplementation(() => time)
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  const commit = vi.fn(), cancel = vi.fn()
  try {
    await act(async () => root.render(
      <ShelfInscription ready error="" anchor={{ x: .5, y: .5 }} onCommit={commit} onCancel={cancel} />
    ))
    const input = host.querySelector('input')!
    const form = host.querySelector('form')!
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setValue.call(input, '  山窗随记  ')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const submit = () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    submit()
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    submit()
    expect(commit).not.toHaveBeenCalled()
    time += 100
    submit()
    expect(commit).toHaveBeenCalledExactlyOnceWith('山窗随记')
    host.querySelector<HTMLButtonElement>('[aria-label="取消添书"]')!.click()
    expect(cancel).toHaveBeenCalledOnce()
    expect(commit).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
