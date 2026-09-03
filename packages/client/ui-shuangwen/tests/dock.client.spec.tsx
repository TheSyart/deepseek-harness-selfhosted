// @vitest-environment jsdom
/**
 * The dock's rendering rules and click behavior. Visibility follows the
 * session's preset and interaction state; blank sessions offer stage-only
 * premise chips, started sessions offer stage-and-send continue chips.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationSnapshot, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import { ShuangwenDock } from '../src/client/ShuangwenDock.tsx'
import type { ShuangwenDockProps } from '../src/client/ShuangwenDock.tsx'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

/** The input-phase union the dock reads, restated locally for the fixture. */
type Phase = 'plain' | 'adjudicating' | 'claimed' | 'submitting'

function renderDock(options: {
  agentPreset?: string
  removed?: boolean
  running?: boolean
  blank?: boolean
  draft?: string
  phase?: Phase
}): { setDraft: ReturnType<typeof vi.fn>; submit: ReturnType<typeof vi.fn> } {
  // Fakes carry exactly the members the dock reads; the whole-object casts
  // bypass the runtime-typed state shapes a fixture never populates.
  const sessions = createSnapshotStore<SessionListState>({
    ids: ['s1'],
    byId: { s1: { agentPreset: options.agentPreset } },
    current: 's1',
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  } as unknown as SessionListState)
  const session = createSnapshotStore<ConversationSnapshot>({
    removed: options.removed ?? false,
    running: options.running ?? false,
    blank: options.blank ?? false,
  } as unknown as ConversationSnapshot)
  const input = createSnapshotStore<{ draft: string; phase: Phase }>({
    draft: options.draft ?? '',
    phase: options.phase ?? 'plain',
  })
  const setDraft = vi.fn()
  const submit = vi.fn()
  render(<ShuangwenDock {...({
    useSessions: bindSnapshotSelector(sessions),
    useSession: bindSnapshotSelector(session),
    useInput: bindSnapshotSelector(input),
    inputActions: { setDraft, submit },
    t: (key: keyof typeof zh) => zh[key],
  } as unknown as ShuangwenDockProps)} />)
  return { setDraft, submit }
}

/** Sessions-list fake for the no-current-session case. */
const NO_SESSION_LIST = {
  ids: [],
  byId: {},
  current: undefined,
  phase: 'ready',
  subagentsByParent: {},
  jobsBySession: {},
  currentAddress: undefined,
} as unknown as SessionListState

const SHUANGWEN = { agentPreset: 'shuangwen' }

describe('visibility', () => {
  it('renders nothing when the session runs another preset', () => {
    renderDock({ agentPreset: 'standard', blank: false })
    expect(screen.queryByText(zh.continueHint)).toBeNull()
    expect(screen.queryByText(zh.nextChapter)).toBeNull()
  })

  it('renders nothing when no session is current', () => {
    const sessions = createSnapshotStore<SessionListState>(NO_SESSION_LIST)
    const session = createSnapshotStore<ConversationSnapshot>({
      removed: false, running: false, blank: true,
    } as unknown as ConversationSnapshot)
    const input = createSnapshotStore<{ draft: string; phase: Phase }>({ draft: '', phase: 'plain' })
    render(<ShuangwenDock {...({
      useSessions: bindSnapshotSelector(sessions),
      useSession: bindSnapshotSelector(session),
      useInput: bindSnapshotSelector(input),
      inputActions: { setDraft: vi.fn(), submit: vi.fn() },
      t: (key: keyof typeof zh) => zh[key],
    } as unknown as ShuangwenDockProps)} />)
    expect(screen.queryByText(zh.premiseHint)).toBeNull()
  })

  it('renders nothing while the session is removed', () => {
    renderDock({ ...SHUANGWEN, removed: true })
    expect(screen.queryByText(zh.premiseHint)).toBeNull()
    expect(screen.queryByText(zh.continueHint)).toBeNull()
  })

  it('renders nothing while a turn is running', () => {
    renderDock({ ...SHUANGWEN, running: true })
    expect(screen.queryByText(zh.continueHint)).toBeNull()
  })

  it('renders nothing while the draft is non-empty', () => {
    renderDock({ ...SHUANGWEN, draft: '用户正在输入' })
    expect(screen.queryByText(zh.continueHint)).toBeNull()
  })

  it('renders nothing while the input is mid-submission', () => {
    renderDock({ ...SHUANGWEN, phase: 'submitting' })
    expect(screen.queryByText(zh.continueHint)).toBeNull()
  })
})

describe('blank posture', () => {
  it('shows the premise hint and three starter chips', () => {
    renderDock({ ...SHUANGWEN, blank: true })
    expect(screen.getByText(zh.premiseHint)).toBeTruthy()
    expect(screen.getByText(zh.premiseRebirth)).toBeTruthy()
    expect(screen.getByText(zh.premiseCultivation)).toBeTruthy()
    expect(screen.getByText(zh.premiseSignin)).toBeTruthy()
  })

  it('stages the premise without submitting — the first message stays editable', () => {
    const { setDraft, submit } = renderDock({ ...SHUANGWEN, blank: true })
    fireEvent.click(screen.getByText(zh.premiseRebirth))
    expect(setDraft).toHaveBeenCalledTimes(1)
    expect(String(setDraft.mock.calls[0]![0])).toContain('赘婿重生')
    expect(submit).not.toHaveBeenCalled()
  })
})

describe('continue posture', () => {
  it('shows the continue hint and three dial chips', () => {
    renderDock({ ...SHUANGWEN, blank: false })
    expect(screen.getByText(zh.continueHint)).toBeTruthy()
    expect(screen.getByText(zh.nextChapter)).toBeTruthy()
    expect(screen.getByText(zh.moreShuang)).toBeTruthy()
    expect(screen.getByText(zh.climax)).toBeTruthy()
  })

  it('one click stages AND sends — the next chapter starts without typing', () => {
    const { setDraft, submit } = renderDock({ ...SHUANGWEN, blank: false })
    fireEvent.click(screen.getByText(zh.nextChapter))
    expect(setDraft).toHaveBeenCalledWith('继续')
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('the thrill and climax dials stage their turn-up instructions', () => {
    const { setDraft } = renderDock({ ...SHUANGWEN, blank: false })
    fireEvent.click(screen.getByText(zh.moreShuang))
    expect(String(setDraft.mock.calls[0]![0])).toContain('更爽')
    fireEvent.click(screen.getByText(zh.climax))
    expect(String(setDraft.mock.calls[1]![0])).toContain('小高潮')
  })
})

describe('locale', () => {
  it('renders the English copy from the en dictionary', () => {
    const sessions = createSnapshotStore<SessionListState>({
      ids: ['s1'],
      byId: { s1: { agentPreset: 'shuangwen' } },
      current: 's1',
      phase: 'ready',
      subagentsByParent: {},
      jobsBySession: {},
      currentAddress: undefined,
    } as unknown as SessionListState)
    const session = createSnapshotStore<ConversationSnapshot>({
      removed: false, running: false, blank: false,
    } as unknown as ConversationSnapshot)
    const input = createSnapshotStore<{ draft: string; phase: Phase }>({ draft: '', phase: 'plain' })
    render(<ShuangwenDock {...({
      useSessions: bindSnapshotSelector(sessions),
      useSession: bindSnapshotSelector(session),
      useInput: bindSnapshotSelector(input),
      inputActions: { setDraft: vi.fn(), submit: vi.fn() },
      t: (key: keyof typeof en) => en[key],
    } as unknown as ShuangwenDockProps)} />)
    expect(screen.getByText(en.continueHint)).toBeTruthy()
    expect(screen.getByText(en.nextChapter)).toBeTruthy()
  })
})
