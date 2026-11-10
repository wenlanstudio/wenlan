import { nextTick, ref } from 'vue'
import { defineStore } from 'pinia'
import type { StudentMarkdown, StudentRelease } from '@shared/types/auth'
import { t } from '@/i18n'
import { renderQuizSlots, type ActiveQuiz } from '@/util/quizSlot'
import { useEditorStore } from './editor'
import bus from '../bus'

/**
 * 教育版叠加态的共享状态（D10）。
 *
 * 承担：发布对话框与版本指纹、学生端只读讲义、课堂 ws 状态（M2b）。
 * 不持有 token：admin-api 走 window.auth.request，ws 连接由 main 进程持有，
 * 这里只消费脱敏后的 `{type, content}` 帧。
 */

export interface PublishPrefill {
  materialId?: number
  materialName?: string
  courseId?: number
}

export interface LastPublish {
  materialId: number
  versionId: number
  versionNo: number
  releaseCount: number
  contentHash: string
}

/** 发布物引用：一个发布物 = 一个班 × 一个版本，开课堂要精确到班。 */
export interface ReleaseRef {
  releaseId: number
  classId: number
  className: string
}

export interface SavedPublishMeta extends LastPublish {
  purpose: number
  courseId: number
  classIds: number[]
  /** 本次/历次发布留下的发布物，供「开始课堂」选班。旧数据可能没有。 */
  releases?: ReleaseRef[]
}

/** 学生端当前打开的只读讲义（状态栏与教学树共用）。 */
export interface OpenedRelease {
  releaseId: number
  materialName: string
  courseName: string
  purpose: number
  versionNo: number
  variant: string
  slotCount: number
}

/** 课堂跟随与当前发题（M2b ws）。 */
export interface ClassroomState {
  sessionId: number | null
  connected: boolean
  page: number | null
  followLocked: boolean
  question: ActiveQuiz | null
  error: string
  /** 本端角色：教师开班后是 host，学生进房后是 student。 */
  role: 'host' | 'student' | null
  /** 房间在线人数（joined 帧带回，之后靠广播刷新，可缺省）。 */
  online: number
  /** 教师端正在上课的发布物（= 开班时选的班）。 */
  releaseId: number | null
  /** 教师端正在上课的班名，给状态栏与菜单文案用。 */
  className: string
}

const META_PREFIX = 'wenlan.teaching.publish.'

/** 教师端可发题目（服务端 `sessionQuestions` → QuestionDO，只留发题要用的字段）。 */
export interface RaceQuestion {
  id: number
  questionKey: string
  stem: string
  point: number
  type: string
}

export interface LeaderboardRow {
  studentName: string
  studentNo: string
  score: number
  answers: number
  correct: number
}

/** 收卷揭晓载荷（`teaching.race.revealed`）：答案只在此时下发。 */
export interface RaceReveal {
  questionKey: string
  stem: string
  options: string[]
  answer: string
  distribution: number[]
  fastest: { studentNo?: string; durationMs?: number } | null
  leaderboard: LeaderboardRow[]
}

/**
 * 教师端竞答控制台状态（M2b 发题/收卷/揭晓）。
 *
 * 只有 host 会用到；学生端的题目走 `classroom.question`（无答案）。
 * 倒计时用本地 `openedAt`：服务端 `openAt` 是本地时区的无偏移字符串，
 * 客户端不解析它，避免时区误差把倒计时算错。
 */
export interface RaceState {
  visible: boolean
  loading: boolean
  questions: RaceQuestion[]
  openId: number | null
  questionId: number | null
  limitSec: number
  openedAt: number
  answered: number
  online: number
  reveal: RaceReveal | null
  error: string
}

/** 轻量内容指纹（FNV-1a 32 位）。只用于「内容是否变化」的本地判断，不参与服务端校验。 */
export const hashContent = (text: string): string => {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

const readMeta = (pathname: string): SavedPublishMeta | null => {
  try {
    const raw = localStorage.getItem(META_PREFIX + pathname)
    return raw ? (JSON.parse(raw) as SavedPublishMeta) : null
  } catch {
    return null
  }
}

const writeMeta = (pathname: string, meta: SavedPublishMeta): void => {
  try {
    localStorage.setItem(META_PREFIX + pathname, JSON.stringify(meta))
  } catch {
    // localStorage 不可用时只是记不住指纹（下次按内容已变处理），不影响发布本身。
  }
}

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')

/** race.opened / joined.race 快照 → 当前题；questionKey 缺失时用 roundQid 兜底。 */
const parseQuestion = (raw: unknown): ActiveQuiz | null => {
  if (!raw || typeof raw !== 'object') return null
  const q = raw as Record<string, unknown>
  const questionKey = asString(q.questionKey) || asString(q.roundQid)
  if (!questionKey) return null
  const options = Array.isArray(q.options)
    ? q.options.filter((item): item is string => typeof item === 'string')
    : []
  return {
    questionKey,
    stem: asString(q.stem),
    options,
    limitSec: asNumber(q.limitSec)
  }
}

const emptyClassroom = (): ClassroomState => ({
  sessionId: null,
  connected: false,
  page: null,
  followLocked: false,
  question: null,
  error: '',
  role: null,
  online: 0,
  releaseId: null,
  className: ''
})

const emptyRace = (): RaceState => ({
  visible: false,
  loading: false,
  questions: [],
  openId: null,
  questionId: null,
  limitSec: 30,
  openedAt: 0,
  answered: 0,
  online: 0,
  reveal: null,
  error: ''
})

/** `teaching.race.question-list` → 发题用的题目精简列表。 */
const parseQuestionList = (raw: unknown): RaceQuestion[] => {
  if (!Array.isArray(raw)) return []
  const rows: RaceQuestion[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const q = item as Record<string, unknown>
    const id = asNumber(q.id)
    if (!id) continue
    rows.push({
      id,
      questionKey: asString(q.questionKey),
      stem: asString(q.stem),
      point: asNumber(q.point, 5),
      type: asString(q.type) || 'single'
    })
  }
  return rows
}

const parseLeaderboard = (raw: unknown): LeaderboardRow[] => {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 20).map((item) => {
    const row = (item ?? {}) as Record<string, unknown>
    return {
      studentName: asString(row.studentName),
      studentNo: asString(row.studentNo),
      score: asNumber(row.score),
      answers: asNumber(row.answers),
      correct: asNumber(row.correct)
    }
  })
}

/** `teaching.race.revealed` 载荷（含答案与分布）。 */
const parseReveal = (content: Record<string, unknown>): RaceReveal => {
  const fastestRaw = content.fastest as Record<string, unknown> | null | undefined
  return {
    questionKey: asString(content.questionKey) || asString(content.roundQid),
    stem: asString(content.stem),
    options: Array.isArray(content.options)
      ? content.options.filter((item): item is string => typeof item === 'string')
      : [],
    answer: asString(content.answer),
    distribution: Array.isArray(content.distribution)
      ? content.distribution.map((n) => asNumber(n))
      : [],
    fastest: fastestRaw
      ? { studentNo: asString(fastestRaw.studentNo), durationMs: asNumber(fastestRaw.durationMs) }
      : null,
    leaderboard: parseLeaderboard(content.leaderboard)
  }
}

// 同一 renderer 内只订阅一次 ws 推送；每个窗口有独立 renderer，互不影响。
let wsListening = false

export const useTeachingStore = defineStore('teaching', () => {
  const publishVisible = ref(false)
  const prefill = ref<PublishPrefill>({})
  const lastPublish = ref<LastPublish | null>(null)
  /** 学生端当前打开的只读讲义（状态栏与教学树共用）。 */
  const openedRelease = ref<OpenedRelease | null>(null)
  const classroom = ref<ClassroomState>(emptyClassroom())
  const race = ref<RaceState>(emptyRace())
  /** 教师端上次上报的页号：md2s:change 每翻一页都会来，去重后再发。 */
  let reportedPage = 0

  /** 服务端派生的学生版 md 原文，按课堂状态重新渲染时用它作唯一来源。 */
  const sourceMd = ref('')
  /** 当前学生只读 tab 的 id，重开时只关自己，不误伤用户的其他文档。 */
  const studentTabId = ref<string | null>(null)

  const renderStudentDocument = (): { md: string; slotCount: number } =>
    renderQuizSlots(sourceMd.value, {
      waiting: t('teaching.quizSlotWaiting'),
      hint: t('teaching.quizSlotHint'),
      activeLabel: t('teaching.quizActive'),
      question: classroom.value.question
    })

  const openReadOnlyTab = async(md: string, replace: boolean): Promise<void> => {
    const editor = useEditorStore()
    const current = editor.currentFile
    if (replace && current && (!studentTabId.value || current.id === studentTabId.value)) {
      editor.FORCE_CLOSE_TAB(current)
    }
    bus.emit('mt::new-untitled-tab', { selected: true, markdown: md })
    await nextTick()
    editor.SET_READ_ONLY(true)
    studentTabId.value = editor.currentFile?.id ?? null
  }

  /** 发题/收卷/进房后重渲染：把对应 slot 换成题目卡或退回占位。 */
  const refreshStudentDocument = async(): Promise<void> => {
    if (!openedRelease.value || !sourceMd.value) return
    const view = renderStudentDocument()
    await openReadOnlyTab(view.md, true)
    openedRelease.value = { ...openedRelease.value, slotCount: view.slotCount }
  }

  const onClassroomMessage = (message: {
    type: string
    content: Record<string, unknown>
  }): void => {
    const { type, content } = message
    switch (type) {
      case 'teaching.session.joined': {
        const role = asString(content.role)
        classroom.value.page = asNumber(content.page, 1)
        classroom.value.followLocked = content.followLocked === true
        classroom.value.online = asNumber(content.online)
        if (role === 'host') {
          // 教师端：joined 只用来确认房间与初始页，不重渲染任何文档
          classroom.value.role = 'host'
          reportedPage = classroom.value.page
          // 断线重进时恢复正在进行的轮次（服务端 joined 带 race 快照）
          const snapshot = parseQuestion(content.race)
          if (snapshot) {
            classroom.value.question = snapshot
            race.value.openId = asNumber(content.race && (content.race as Record<string, unknown>).openId) || race.value.openId
            race.value.answered = asNumber(content.answered, race.value.answered)
            race.value.online = asNumber(content.online, race.value.online)
            race.value.questionId =
              asNumber(content.race && (content.race as Record<string, unknown>).questionId) ||
              race.value.questionId
            race.value.reveal = null
            if (!race.value.openedAt) race.value.openedAt = Date.now()
          }
        } else if (role === 'student') {
          classroom.value.role = 'student'
          classroom.value.question = parseQuestion(content.race)
          void refreshStudentDocument()
        }
        break
      }
      case 'teaching.session.page':
        classroom.value.page = asNumber(content.page, classroom.value.page ?? 1)
        break
      case 'teaching.session.follow':
        classroom.value.followLocked =
          content.locked === true || content.followLocked === true
        break
      case 'teaching.race.question-list':
        race.value.questions = parseQuestionList(content.questions)
        race.value.openId = asNumber(content.openId) || null
        race.value.loading = false
        break
      case 'teaching.race.opened': {
        classroom.value.question = parseQuestion(content)
        // 教师端也在这条广播里：本地先记下发题轮次，收卷/作废才有 openId 可用
        race.value.openId = asNumber(content.openId) || null
        race.value.questionId = asNumber(content.questionId) || null
        race.value.limitSec = asNumber(content.limitSec, race.value.limitSec)
        race.value.openedAt = Date.now()
        race.value.answered = 0
        race.value.reveal = null
        race.value.error = ''
        if (classroom.value.role === 'student') void refreshStudentDocument()
        break
      }
      case 'teaching.race.answered':
        race.value.answered = asNumber(content.answered, race.value.answered)
        // 在线人数也在这条帧里刷新：状态栏与控制台的「已答 N/M」都用它
        race.value.online = asNumber(content.online, race.value.online)
        classroom.value.online = race.value.online
        break
      case 'teaching.race.revealed':
        race.value.reveal = parseReveal(content)
        race.value.openId = null
        race.value.questionId = null
        classroom.value.question = null
        if (classroom.value.role === 'student') void refreshStudentDocument()
        break
      case 'teaching.race.voided':
        race.value.openId = null
        race.value.questionId = null
        race.value.answered = 0
        classroom.value.question = null
        if (classroom.value.role === 'student') void refreshStudentDocument()
        break
      case 'teaching.session.closed':
        // 会话结束：教师端整块复位，学生端只退回占位、保留只读讲义
        if (classroom.value.role === 'host') {
          classroom.value = emptyClassroom()
          race.value = emptyRace()
          reportedPage = 0
          break
        }
        classroom.value.question = null
        void refreshStudentDocument()
        break
      case 'teaching.error':
        classroom.value.error = asString(content.message)
        if (race.value.visible) race.value.loading = false
        race.value.error = asString(content.message)
        break
      default:
        break
    }
  }

  const listenClassroom = (): void => {
    if (wsListening) return
    wsListening = true
    window.teachingSocket.onMessage(onClassroomMessage)
    window.teachingSocket.onStatus((status) => {
      classroom.value.connected = status.connected
      if (status.sessionId != null) classroom.value.sessionId = status.sessionId
    })
  }
  listenClassroom()

  /** 打开讲义后进房；没有进行中的会话时保持占位态，不打断阅读。 */
  const joinClassroom = async(releaseId: number): Promise<void> => {
    classroom.value.error = ''
    const res = await window.teachingSocket.join(releaseId)
    if (!res.ok) {
      classroom.value.connected = false
      classroom.value.sessionId = null
      classroom.value.error = res.error ?? ''
      return
    }
    classroom.value.sessionId = res.sessionId ?? null
  }

  const leaveClassroom = async(): Promise<void> => {
    await window.teachingSocket.leave()
    classroom.value = emptyClassroom()
    await refreshStudentDocument()
  }

  /**
   * 教师端开班并进房（D10 叠加态：入口在状态栏/菜单，没有第二个窗口）。
   *
   * 返回错误文案（空串=成功）。服务端 `/class-session/get` 已有进行中会话时
   * main 侧直接复用，不重复开班——教师连点两下不该堆出两条并行会话。
   */
  const startClassroom = async(ref: ReleaseRef): Promise<string> => {
    classroom.value.error = ''
    const res = await window.teachingSocket.host(ref.releaseId)
    if (!res.ok) {
      classroom.value.error = res.error ?? ''
      return classroom.value.error
    }
    classroom.value = {
      ...emptyClassroom(),
      sessionId: res.sessionId ?? null,
      role: 'host',
      page: 1,
      releaseId: ref.releaseId,
      className: ref.className
    }
    reportedPage = 0
    return ''
  }

  /** 教师端结束课堂：落库 endedAt + 退房，学生收到 teaching.session.closed。 */
  const endClassroom = async(): Promise<void> => {
    const sessionId = classroom.value.sessionId
    await window.teachingSocket.end(sessionId)
    classroom.value = emptyClassroom()
    reportedPage = 0
  }

  /** 教师端上报页码（只在 host 角色下有效，重复页号不外发）。 */
  const reportPage = (page: number): void => {
    if (classroom.value.role !== 'host') return
    const target = Math.floor(Number(page))
    if (!Number.isFinite(target) || target < 1 || target === reportedPage) return
    reportedPage = target
    // 本地先动，不等广播回来，状态栏与 deck 页号才不滞后
    classroom.value.page = target
    void window.teachingSocket.page(target)
  }

  /** 教师端跟随锁：锁上后学生不能被自己的翻页带走。 */
  const setFollowLocked = (locked: boolean): void => {
    if (classroom.value.role !== 'host') return
    classroom.value.followLocked = locked
    void window.teachingSocket.follow(locked)
  }

  // ==================== 竞答控制台（host） ====================

  /** 拉本讲义可发题目（异步回帧 `teaching.race.question-list`）。 */
  const loadRaceQuestions = (): void => {
    race.value.loading = true
    void window.teachingSocket.raceQuestions()
    // 回帧可能因为 ws 正在重连而丢掉，别让「加载中」永远转下去
    setTimeout(() => {
      if (race.value.loading) race.value.loading = false
    }, 4000)
  }

  /** 打开控制台：只对 host 有意义，未开课时返回一句提示给调用方。 */
  const openQuizConsole = (): string => {
    if (classroom.value.role !== 'host') return t('teaching.quizNeedClassroom')
    if (!classroom.value.connected) return t('teaching.quizDisconnected')
    race.value.visible = true
    race.value.error = ''
    loadRaceQuestions()
    return ''
  }

  const closeQuizConsole = (): void => {
    race.value.visible = false
  }

  /**
   * 发题。服务端一题一轮，进行中再发会被 `RACE_ALREADY_OPEN` 挡回，
   * 所以这里先在本地挡一次，避免把错误刷到界面上。
   */
  const openRaceQuestion = (question: RaceQuestion, limitSec?: number): string => {
    if (classroom.value.role !== 'host') return t('teaching.quizNeedClassroom')
    if (race.value.openId != null) return t('teaching.quizRoundRunning')
    const limit = Math.min(300, Math.max(5, Math.floor(limitSec ?? race.value.limitSec)))
    race.value.limitSec = limit
    race.value.error = ''
    race.value.reveal = null
    race.value.questionId = question.id
    void window.teachingSocket.raceOpen(question.id, limit)
    return ''
  }

  /** 收卷揭晓（到点服务端也会自动收，这里只是提前收）。 */
  const closeRaceRound = (): void => {
    const openId = race.value.openId
    if (openId == null) return
    void window.teachingSocket.raceClose(openId)
  }

  /** 作废进行中的题：记录保留、得分清零。 */
  const voidRaceRound = (): void => {
    const openId = race.value.openId
    if (openId == null) return
    void window.teachingSocket.raceVoid(openId)
  }

  /** 学生端：拉派生 md，渲染占位/题目卡，开成只读文档，然后尝试进课堂。 */
  const openStudentRelease = async(release: StudentRelease): Promise<string> => {
    const res = await window.auth.request<StudentMarkdown>({
      url: '/teaching/student/release/markdown',
      params: { releaseId: release.releaseId }
    })
    if (!res.ok) {
      return res.error ?? `HTTP ${res.status}`
    }
    sourceMd.value = res.data?.md ?? ''
    classroom.value.question = null
    const view = renderStudentDocument()
    await openReadOnlyTab(view.md, true)
    openedRelease.value = {
      releaseId: release.releaseId,
      materialName: release.materialName,
      courseName: release.courseName,
      purpose: release.purpose,
      versionNo: release.versionNo,
      variant: res.data?.variant ?? 'reading',
      slotCount: view.slotCount
    }
    void joinClassroom(release.releaseId)
    return ''
  }

  // localStorage 不是响应式的：每次写元数据递增，让读元数据的 computed 重新求值
  const metaRev = ref(0)

  /** 当前文档可开班的教学班列表（发布时记下的发布物）。 */
  const releasesFor = (pathname: string): ReleaseRef[] => {
    void metaRev.value
    return readMeta(pathname)?.releases ?? []
  }

  const openPublish = (options: PublishPrefill = {}): void => {
    prefill.value = options
    publishVisible.value = true
    bus.emit('teaching::publish-opened', options)
  }

  const closePublish = (): void => {
    publishVisible.value = false
  }

  const metaFor = (pathname: string): SavedPublishMeta | null => {
    void metaRev.value
    return readMeta(pathname)
  }

  const remember = (pathname: string, meta: SavedPublishMeta): void => {
    writeMeta(pathname, meta)
    metaRev.value++
    lastPublish.value = {
      materialId: meta.materialId,
      versionId: meta.versionId,
      versionNo: meta.versionNo,
      releaseCount: meta.releaseCount,
      contentHash: meta.contentHash
    }
  }

  const restoreLast = (pathname: string): void => {
    const meta = readMeta(pathname)
    if (!meta) {
      lastPublish.value = null
      return
    }
    lastPublish.value = {
      materialId: meta.materialId,
      versionId: meta.versionId,
      versionNo: meta.versionNo,
      releaseCount: meta.releaseCount,
      contentHash: meta.contentHash
    }
  }

  return {
    publishVisible,
    prefill,
    lastPublish,
    openedRelease,
    classroom,
    race,
    openPublish,
    closePublish,
    openStudentRelease,
    joinClassroom,
    leaveClassroom,
    startClassroom,
    endClassroom,
    reportPage,
    setFollowLocked,
    openQuizConsole,
    closeQuizConsole,
    loadRaceQuestions,
    openRaceQuestion,
    closeRaceRound,
    voidRaceRound,
    releasesFor,
    metaFor,
    remember,
    restoreLast
  }
})
