/**
 * 课堂跟随的纯判定（M2b）。
 *
 * ws 的 `teaching.session.page` 只带一个 1 基页号，宿主要做两件事：
 * ① 把页号转成发给 deck 页面的 `md2s:follow`；② 锁定跟随时把学生自己翻走的页
 * 拉回来。两条判定都不碰 Vue / DOM，抽出来单测——它们的分支（没进会话 / 页号
 * 缺失 / 冷却期）在真机上很难复现，靠手点是测不出来的。
 *
 * 教师端也 join 同一个房间（上报页码走同一条 ws），但**不能被自己跟随**：
 * host 的页号是他自己翻出来的，跟随自己会造成 上报 → 广播 → goto → change 的
 * 回环，且一旦 followLocked 把老师自己也锁住就没法讲课。故 role=host 直接给
 * "不跟随"，与"不在课堂"同一条路径。
 */

export interface ClassroomFollowState {
  /** 已 join 的课堂会话；null = 不在课堂里。 */
  sessionId: number | null
  /** 老师当前页（1 基）；null/0 = 服务端还没给过。 */
  page: number | null
  /** 服务端 followLocked：锁定时学生不能自己翻页。 */
  followLocked: boolean
  /** 本端在房间里的角色；host 恒不跟随。 */
  role?: 'host' | 'student' | null
}

export interface FollowTarget {
  /** 要对齐到的 1 基页号；0 = 本次不发 follow。 */
  page: number
  /** 是否锁死导航键。 */
  locked: boolean
}

/** 回弹冷却：goto 会触发一次 `md2s:change`（index === 目标页），给足这段窗口
 *  再判，避免「回弹 → change → 又回弹」抖成死循环。 */
export const SNAP_BACK_COOLDOWN_MS = 800

export const followTargetOf = (state: ClassroomFollowState): FollowTarget => {
  if (state.sessionId == null) {
    // 不在课堂：不跟随、不锁。通用实例与未开课的放映落这里。
    return { page: 0, locked: false }
  }
  if (state.role === 'host') {
    // 教师端：页号是他自己翻出来的，跟随自己会形成回环，也绝不能锁住自己。
    return { page: 0, locked: false }
  }
  const page = Number(state.page)
  return {
    page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 0,
    // 锁只在真有页可跟时成立：没有页号的"锁"只会把学生按在原地翻不动。
    locked: state.followLocked === true
  }
}

/**
 * 锁定跟随时是否要把当前页拉回老师页。
 *
 * @param index       deck 当前页（1 基）
 * @param target      followTargetOf 给出的目标页（0 = 不跟随）
 * @param locked      是否锁定跟随
 * @param sinceSentMs 距上次发 follow 的毫秒数
 */
export const shouldSnapBack = (
  index: number,
  target: number,
  locked: boolean,
  sinceSentMs: number,
  cooldownMs: number = SNAP_BACK_COOLDOWN_MS
): boolean => {
  if (!locked || target < 1) return false
  if (index === target) return false
  return sinceSentMs >= cooldownMs
}
