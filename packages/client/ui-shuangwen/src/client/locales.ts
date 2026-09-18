/**
 * Dictionary set for the shuangwen quick-action strip. The staged MESSAGE
 * texts are not copy: they are the payload a chip writes into the draft, so
 * they stay constants beside the component rather than ride the locale seat.
 */

export const zh = {
  premiseHint: '开书脑洞',
  continueHint: '无脑续写',
  premiseRebirth: '赘婿重生',
  premiseCultivation: '废柴修仙',
  premiseSignin: '末日签到',
  nextChapter: '下一章',
  moreShuang: '加大爽度',
  climax: '来个小高潮',
}

export const en = {
  premiseHint: 'Story starters',
  continueHint: 'Quick continue',
  premiseRebirth: 'Son-in-law reborn',
  premiseCultivation: 'Wastrel cultivator',
  premiseSignin: 'Doomsday sign-in',
  nextChapter: 'Next chapter',
  moreShuang: 'More thrill',
  climax: 'A climax',
}

/** Dictionary key union for the `shuangwen` locale namespace. */
export type ShuangwenKey = keyof typeof zh
