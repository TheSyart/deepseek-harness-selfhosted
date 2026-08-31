/**
 * Shuangwen quick-action strip, mounted as a `conversation.input.dock` entry.
 *
 * Visible only while the current session runs on the `shuangwen` preset. Two
 * postures:
 *
 * - A blank session (no user message yet) offers premise chips — one click
 *   stages a full 开书 prompt into the draft, and the user sends it when
 *   ready (the first message fixes the whole book, so it stays editable).
 * - A started session offers continue chips — one click stages the
 *   instruction AND submits it, which is the whole point of 无脑: the next
 *   chapter starts without typing.
 *
 * The strip hides itself while the session is removed, a turn is running,
 * the input is mid-submission, or the draft is non-empty (never clobber what
 * the user is typing). Pure presentation: every fact rides the framework
 * hooks, and sending rides the public input action face.
 */

import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (the dock hole) and its
// SessionStandardProps members (useInput/inputActions).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ShuangwenKey } from './locales.ts'
import css from './ShuangwenDock.module.css'

/** The preset id this strip serves — the directory name of the shipped preset. */
export const SHUANGWEN_PRESET_ID = 'shuangwen'

/** One quick action: the chip label key, the staged message, and whether it sends. */
interface ShuangwenAction {
  /** Dictionary key of the chip label. */
  label: ShuangwenKey
  /** Message staged into the draft. */
  text: string
  /** Stage-and-send on click; premise chips only stage, the user sends. */
  submit: boolean
}

/**
 * Premise prompts for the blank posture. Each is a complete 开书 request the
 * persona consumes without follow-up questions, matching its 无脑 contract.
 */
const PREMISE_ACTIONS: ShuangwenAction[] = [
  {
    label: 'premiseRebirth',
    text: '开一本都市爽文:赘婿重生,开局被岳母当众羞辱,金手指是神级医术,第一章就要当众打脸岳母一家。',
    submit: false,
  },
  {
    label: 'premiseCultivation',
    text: '开一本修仙爽文:废柴少年觉醒混沌圣体,宗门大比一鸣惊人,当众打脸所有看不起他的人。',
    submit: false,
  },
  {
    label: 'premiseSignin',
    text: '开一本末日爽文:全球灵气复苏,我觉醒签到系统,每天签到就变强,第一章碾压看不起我的同学。',
    submit: false,
  },
]

/**
 * Continue prompts for the started posture. Each stages and SUBMITS, so one
 * click starts the next chapter with the requested dial turned up.
 */
const CONTINUE_ACTIONS: ShuangwenAction[] = [
  { label: 'nextChapter', text: '继续', submit: true },
  { label: 'moreShuang', text: '继续。这一章要更爽:打脸、装逼、反转一起来,爽点加倍。', submit: true },
  { label: 'climax', text: '继续。写一章小高潮:主角亮出底牌,全场震惊,开始回收前面的伏笔。', submit: true },
]

/** Full component props: the dock owner share + session/global kits + locale seat. */
export type ShuangwenDockProps = PropsRuntime<'conversation.input.dock'> & PropsLocale<'shuangwen'>

/** One session's preset id, or undefined while no session is current. */
function useCurrentPreset(useSessions: ShuangwenDockProps['useSessions']): string | undefined {
  return useSessions(s => {
    if (s.current === undefined) return undefined
    return s.byId[s.current]?.agentPreset
  })
}

/**
 * Render the quick-action strip, or null outside a shuangwen session or
 * while interaction would be unsafe.
 * @param props - composed dock props.
 * @returns the strip element, or null.
 */
export function ShuangwenDock(props: ShuangwenDockProps): ReactNode {
  const { useSession, useInput, inputActions, useSessions, t } = props
  const presetId = useCurrentPreset(useSessions)
  const removed = useSession(s => s.removed)
  const running = useSession(s => s.running)
  const blank = useSession(s => s.blank)
  const draft = useInput(s => s.draft)
  const phase = useInput(s => s.phase)

  if (presetId !== SHUANGWEN_PRESET_ID || removed || running) return null
  // A mid-submission or non-empty draft is the user's own work in progress.
  if (phase !== 'plain' || draft !== '') return null

  const actions = blank ? PREMISE_ACTIONS : CONTINUE_ACTIONS
  const hint = blank ? t('premiseHint') : t('continueHint')

  return (
    <div className={css.dock} data-shuangwen-dock="">
      <span className={css.hint}>{hint}</span>
      <div className={css.chips}>
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            className={css.chip}
            onClick={() => {
              inputActions.setDraft(action.text)
              if (action.submit) inputActions.submit()
            }}
          >
            {t(action.label)}
          </button>
        ))}
      </div>
    </div>
  )
}
