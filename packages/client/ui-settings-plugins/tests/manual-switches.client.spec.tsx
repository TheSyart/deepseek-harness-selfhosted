// @vitest-environment jsdom
/**
 * The manual-switches tab: one card per managed interface plugin, an instant
 * switch that persists, and a failure line when the widget cannot load.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ManualSwitchesTab } from '../src/client/ManualSwitchesTab.tsx'
import type { ManualSwitchesTabProps } from '../src/client/ManualSwitchesTab.tsx'
import { RHEOSTAT_PET_FRAMES, RHEOSTAT_PET_KEY } from '../src/client/manual-widgets.ts'
import { en } from '../src/client/locales.ts'

const t = (key: keyof typeof en) => en[key]

function renderTab() {
  render(<ManualSwitchesTab {...{ t } as unknown as ManualSwitchesTabProps} />)
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  delete window.RheostatPet
})

describe('ManualSwitchesTab', () => {
  it('starts off and explains itself', () => {
    renderTab()

    const switchButton = screen.getByRole('switch', { name: t('rheostatPetToggleLabel') })
    expect(switchButton).toHaveProperty('ariaChecked', 'false')
    expect(screen.getByText(t('rheostatPetTitle'))).toBeTruthy()
    expect(screen.getByText(t('rheostatPetOff'))).toBeTruthy()
  })

  it('restores the switch from the saved state', () => {
    localStorage.setItem(RHEOSTAT_PET_KEY, '1')
    renderTab()

    expect(screen.getByRole('switch', { name: t('rheostatPetToggleLabel') })).toHaveProperty('ariaChecked', 'true')
    expect(screen.getByText(t('rheostatPetOn'))).toBeTruthy()
  })

  it('mounts the pet on the first switch-on and remembers the choice', async () => {
    const mount = vi.fn()
    window.RheostatPet = { mount, unmount: vi.fn() }
    renderTab()

    fireEvent.click(screen.getByRole('switch', { name: t('rheostatPetToggleLabel') }))

    await vi.waitFor(() => { expect(mount).toHaveBeenCalledWith({ framesBase: RHEOSTAT_PET_FRAMES }) })
    expect(localStorage.getItem(RHEOSTAT_PET_KEY)).toBe('1')
    expect(screen.getByRole('switch', { name: t('rheostatPetToggleLabel') })).toHaveProperty('ariaChecked', 'true')
    expect(screen.getByText(t('rheostatPetOn'))).toBeTruthy()
  })

  it('unmounts the pet on switch-off and remembers the choice', async () => {
    localStorage.setItem(RHEOSTAT_PET_KEY, '1')
    const unmount = vi.fn()
    window.RheostatPet = { mount: vi.fn(), unmount }
    renderTab()

    fireEvent.click(screen.getByRole('switch', { name: t('rheostatPetToggleLabel') }))

    await vi.waitFor(() => { expect(unmount).toHaveBeenCalledOnce() })
    expect(localStorage.getItem(RHEOSTAT_PET_KEY)).toBe('0')
    expect(screen.getByRole('switch', { name: t('rheostatPetToggleLabel') })).toHaveProperty('ariaChecked', 'false')
  })

  it('reports a load failure and keeps the switch off', async () => {
    const mount = vi.fn(() => { throw new Error('load failed') })
    window.RheostatPet = { mount, unmount: vi.fn() }
    renderTab()

    fireEvent.click(screen.getByRole('switch', { name: t('rheostatPetToggleLabel') }))

    await vi.waitFor(() => { expect(screen.getByText(t('rheostatPetFailed'))).toBeTruthy() })
    expect(screen.getByRole('switch', { name: t('rheostatPetToggleLabel') })).toHaveProperty('ariaChecked', 'false')
  })
})
