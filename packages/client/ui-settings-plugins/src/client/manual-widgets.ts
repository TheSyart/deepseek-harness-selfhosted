/**
 * 手动开关管理的界面插件：目前唯一的成员是「滑动变祖器宠物」。
 *
 * 生命周期：
 * - 开关状态保存在 localStorage（`dsh.ui.manualWidgets.rheostat-pet.enabled`）；
 * - 开启 = 懒加载宠物脚本（前端 dist 的静态资源）并挂载悬浮小部件；
 * - 关闭 = 卸载小部件（脚本留在页面缓存里，下次开启直接复用）；
 * - 应用启动时按记忆恢复一次，让宠物在刷新后依然悬浮。
 *
 * 开关是纯浏览器侧的行为，不经过 Host 设置域：宠物自身的位置/强度
 * 也保存在 localStorage，与这里的开关键互不干扰。
 */

declare global {
  interface Window {
    /** 宠物插件的全局配置（模块导入时读取，用于关闭自动挂载）。 */
    RheostatPetConfig?: { auto?: boolean }
    /** 宠物插件暴露的全局 API（脚本加载后由插件自行安装）。 */
    RheostatPet?: {
      mount(options?: { framesBase?: string }): unknown
      unmount(): void
    }
  }
}

/** localStorage 键：变阻器宠物开关。 */
export const RHEOSTAT_PET_KEY = 'dsh.ui.manualWidgets.rheostat-pet.enabled'

/** 宠物脚本与帧图的前端静态地址（apps/web/public/rheostat-pet/）。 */
export const RHEOSTAT_PET_SCRIPT = '/rheostat-pet/rheostat-pet.js'
export const RHEOSTAT_PET_FRAMES = '/rheostat-pet/frames/'

/** 开关当前是否打开（存储不可用时视为关闭）。 */
export function isRheostatPetEnabled(): boolean {
  try {
    return localStorage.getItem(RHEOSTAT_PET_KEY) === '1'
  } catch {
    return false
  }
}

let scriptPromise: Promise<void> | null = null

/**
 * 懒加载宠物脚本（只加载一次）。加载前设置 `auto: false`，
 * 让挂载时机完全由本控制器决定。
 */
function ensureRheostatPetScript(): Promise<void> {
  if (window.RheostatPet) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise<void>((resolve, reject) => {
    window.RheostatPetConfig = { auto: false }
    const el = document.createElement('script')
    el.type = 'module'
    el.src = RHEOSTAT_PET_SCRIPT
    el.onload = () => { resolve() }
    el.onerror = () => {
      scriptPromise = null
      reject(new Error('rheostat-pet: script failed to load'))
    }
    document.head.appendChild(el)
  })
  return scriptPromise
}

/** 打开开关并挂载宠物。 */
export async function enableRheostatPet(): Promise<void> {
  try {
    localStorage.setItem(RHEOSTAT_PET_KEY, '1')
  } catch {
    /* 存储不可用时仅本次会话生效 */
  }
  await ensureRheostatPetScript()
  window.RheostatPet?.mount({ framesBase: RHEOSTAT_PET_FRAMES })
}

/** 关闭开关并卸载宠物。 */
export function disableRheostatPet(): void {
  try {
    localStorage.setItem(RHEOSTAT_PET_KEY, '0')
  } catch {
    /* 存储不可用时仅本次会话生效 */
  }
  window.RheostatPet?.unmount()
}

/** 启动时恢复：开关开着就重新挂上宠物。 */
export function restoreRheostatPet(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  if (!isRheostatPetEnabled()) return
  void enableRheostatPet().catch((error: unknown) => {
    console.warn('[ui-settings-plugins] restore rheostat pet failed', error)
  })
}
