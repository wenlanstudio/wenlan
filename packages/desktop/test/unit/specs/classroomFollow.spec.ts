import { describe, expect, it } from 'vitest'

import { SNAP_BACK_COOLDOWN_MS, followTargetOf, shouldSnapBack } from '@/util/classroomFollow'

describe('followTargetOf', () => {
  it('does not follow when not joined to a classroom (teacher deck stays free)', () => {
    expect(followTargetOf({ sessionId: null, page: 4, followLocked: true })).toEqual({
      page: 0,
      locked: false
    })
  })

  it('following without a page number sends nothing', () => {
    expect(followTargetOf({ sessionId: 7, page: null, followLocked: true })).toEqual({
      page: 0,
      locked: true
    })
  })

  it('carries the 1-based page and the lock flag', () => {
    expect(followTargetOf({ sessionId: 7, page: 4, followLocked: true })).toEqual({
      page: 4,
      locked: true
    })
    expect(followTargetOf({ sessionId: 7, page: 4, followLocked: false })).toEqual({
      page: 4,
      locked: false
    })
  })

  it('floors fractional and drops non-positive pages', () => {
    expect(followTargetOf({ sessionId: 7, page: 3.7, followLocked: false }).page).toBe(3)
    expect(followTargetOf({ sessionId: 7, page: 0, followLocked: false }).page).toBe(0)
    expect(followTargetOf({ sessionId: 7, page: -2, followLocked: false }).page).toBe(0)
  })

  // 教师也 join 同一个房间（要上报页码），但跟随自己会形成
  // 上报 → 广播 → goto → change 回环；锁跟随更会把老师自己按在一页上。
  it('never follows on the host side, even with a page and the lock on', () => {
    expect(
      followTargetOf({ sessionId: 7, page: 4, followLocked: true, role: 'host' })
    ).toEqual({ page: 0, locked: false })
    expect(
      followTargetOf({ sessionId: 7, page: 4, followLocked: false, role: 'host' })
    ).toEqual({ page: 0, locked: false })
  })

  it('students still follow when the role is explicit', () => {
    expect(
      followTargetOf({ sessionId: 7, page: 4, followLocked: true, role: 'student' })
    ).toEqual({ page: 4, locked: true })
  })
})

describe('shouldSnapBack', () => {
  it('never snaps back when unlocked', () => {
    expect(shouldSnapBack(9, 4, false, 10_000)).toBe(false)
  })

  it('never snaps back without a target page', () => {
    expect(shouldSnapBack(9, 0, true, 10_000)).toBe(false)
  })

  it('does nothing when already on the teacher page', () => {
    expect(shouldSnapBack(4, 4, true, 10_000)).toBe(false)
  })

  it('respects the cooldown window right after a goto', () => {
    expect(shouldSnapBack(9, 4, true, SNAP_BACK_COOLDOWN_MS - 1)).toBe(false)
    expect(shouldSnapBack(9, 4, true, SNAP_BACK_COOLDOWN_MS)).toBe(true)
  })
})
