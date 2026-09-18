/**
 * 「手动开关」标签页：手动管理界面插件的开关。
 * 每个插件一张卡片，开关即时生效并写入 localStorage，
 * 应用下次启动时按开关状态恢复。目前只有滑动变祖器宠物一位成员。
 */

import { useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  disableRheostatPet,
  enableRheostatPet,
  isRheostatPetEnabled,
} from './manual-widgets.ts'
import css from './ManualSwitchesTab.module.css'

/** Props the renderer binds for the manual-switches tab. */
export type ManualSwitchesTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.plugins'>

/**
 * Render the manual-switches page.
 * @param props - locale face for this section's copy.
 * @returns the switch cards of every manually managed interface plugin.
 */
export function ManualSwitchesTab({ t }: ManualSwitchesTabProps) {
  const [enabled, setEnabled] = useState(isRheostatPetEnabled)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const toggle = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setFailed(false)
    try {
      if (enabled) disableRheostatPet()
      else await enableRheostatPet()
      setEnabled(!enabled)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={css.tab}>
      <p className={css.intro}>{t('manualTabIntro')}</p>
      <ul className={css.cards}>
        <li className={css.card}>
          <span className={css.cardText}>
            <span className={css.name}>{t('rheostatPetTitle')}</span>
            <span className={css.description}>{t('rheostatPetDescription')}</span>
          </span>
          <span className={css.status} data-on={enabled ? 'true' : undefined} role="status">
            {t(enabled ? 'rheostatPetOn' : 'rheostatPetOff')}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={t('rheostatPetToggleLabel')}
            className={css.switch}
            data-on={enabled ? 'true' : undefined}
            disabled={busy}
            onClick={() => { void toggle() }}
          >
            <span className={css.thumb} />
          </button>
        </li>
      </ul>
      {failed ? <p className={css.failed} role="status">{t('rheostatPetFailed')}</p> : null}
    </div>
  )
}
