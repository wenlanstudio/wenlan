import { nextTick, ref } from 'vue'
import { defineStore } from 'pinia'
import type { StudentMarkdown, StudentRelease } from '@shared/types/auth'
import { t } from '@/i18n'
import { renderQuizSlots, type ActiveQuiz } from '@/util/quizSlot'
import { useEditorStore } from './editor'
import { useAuthStore } from './auth'
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

/**
 * 学生端当前打开的讲义（E4 起为落盘副本：真实 docPath 可写——学生加笔记批注，
 * 「还原服务端版本」强制重拉覆盖；状态栏与教学树共用）。
 */
export interface OpenedRelease {
  releaseId: number
  materialName: string
  courseName: string
  purpose: number
  versionNo: number
  variant: string
  docPath: string
  fileName: string
  courseKey: string
  /** true = 命中同 releaseId 旧副本原样保留（学生笔记没被覆盖）。 */
  kept: boolean
}

/**
 * E4：已落盘的实验副本（执行面板教学模式的状态源）。
 *
 * docPath 是真实文件路径（{projectsRoot}/{courseCode}/doc/{讲义名}.md）——执行
 * 面板、引擎注册表（trace 注回/sidecar）全靠它锚定。stepOrder 是服务端从教师
 * trace 推导、发布时冻结的锁序快照。
 */
export interface OpenedLabRelease {
  releaseId: number
  docPath: string
  fileName: string
  courseKey: string
  variant: string
  purpose: number
  stepOrder: Array<{ key: string; point: number }>
  /** M4：实验围栏元数据（无判分秘密 body）——服务端判步的证据装配依据。 */
  fences: Array<{ stepKey: string; verb: string; class?: string }>
  closeAt: string | null
  /** true = 命中同 releaseId 旧副本原样保留（学生回填成果没被覆盖）。 */
  kept: boolean
}

/** /lab/copy 的 fences[] 投影（仅收 check-code class=——证据装配要用到的字段）。 */
const parseFences = (raw: unknown): Array<{ stepKey: string; verb: string; class?: string }> => {
  if (!Array.isArray(raw)) return []
  const out: Array<{ stepKey: string; verb: string; class?: string }> = []
  for (const item of raw) {
    const o = (item ?? {}) as Record<string, unknown>
    const stepKey = asString(o.stepKey)
    const verb = asString(o.verb)
    if (!stepKey || !verb) continue
    const cls = asString(o.class)
    out.push({ stepKey, verb, ...(cls ? { class: cls } : {}) })
  }
  return out
}

/** 锁序快照 JSON（stepOrder 字符串）→ 有序步骤清单。 */
const parseStepOrder = (raw: string | null | undefined): Array<{ key: string; point: number }> => {
  try {
    const parsed: unknown = JSON.parse(raw ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => {
        const o = (item ?? {}) as Record<string, unknown>
        return { key: asString(o.key), point: asNumber(o.point) }
      })
      .filter((s) => s.key)
  } catch {
    return []
  }
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
  /** ADR-24 课表自动开房信息（hit 态）：封面叠码与首页卡的数据源；手动开房为 null。 */
  auto: { courseName: string; location: string; joinUrl: string; scheduled: boolean } | null
  /** 课表业务提示（multi / no_release 的 message）：教学首页卡降级展示，未命中为空。 */
  autoNotice: string
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
  rank?: number
  studentName: string
  studentNo: string
  score: number
  answers: number
  correct: number
  offRoster?: boolean
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
  /** 服务端 closeAt 的本地时间戳；倒计时唯一权威，openedAt 只作旧帧兜底 */
  closeAt: number
  answered: number
  online: number
  reveal: RaceReveal | null
  error: string
  /** 缺口 B（2026-11-15）：放映当前页的 quiz 标记 id（===服务端 questionKey），本页题置顶用 */
  pageQuizKeys: string[]
}

/**
 * 学生端答题浮层状态（E5 步 4）。
 *
 * `selected` / `submitted` 都是【本班显示序】下标：服务端按 option_order
 * 还原成原始下标判分，客户端不需要也不应该知道讲义原始顺序。
 */
export interface StudentQuizState {
  visible: boolean
  selected: number | null
  submitted: number | null
  voided: boolean
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

/** 服务端 LocalDateTime.toString() → 本地时间戳；前端只投影，不再自己推算开题时刻。 */
const asServerTime = (value: unknown): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(asString(value))
  if (!m) return 0
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0).getTime()
}

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
  className: '',
  auto: null,
  autoNotice: ''
})

const emptyRace = (): RaceState => ({
  visible: false,
  loading: false,
  questions: [],
  openId: null,
  questionId: null,
  limitSec: 30,
  openedAt: 0,
  closeAt: 0,
  answered: 0,
  online: 0,
  reveal: null,
  error: '',
  pageQuizKeys: []
})

const emptyStudentQuiz = (): StudentQuizState => ({
  visible: false,
  selected: null,
  submitted: null,
  voided: false,
  error: ''
})

/** 新一轮发题：只重置本轮作答痕迹，浮层保持打开让学生直接看到新题。 */
const resetStudentQuizRound = (state: StudentQuizState): void => {
  state.selected = null
  state.submitted = null
  state.voided = false
  state.error = ''
}

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
      rank: asNumber(row.rank),
      studentName: asString(row.studentName),
      studentNo: asString(row.studentNo),
      score: asNumber(row.score),
      answers: asNumber(row.answers),
      correct: asNumber(row.correct),
      offRoster: row.offRoster === true
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
  const studentQuiz = ref<StudentQuizState>(emptyStudentQuiz())
  /** 教师端上次上报的页号：md2s:change 每翻一页都会来，去重后再发。 */
  let reportedPage = 0

  /** 服务端派生的学生版 md 原文，按课堂状态重新渲染时用它作唯一来源。 */
  const sourceMd = ref('')
  /** 当前学生只读 tab 的 id，重开时只关自己，不误伤用户的其他文档。 */
  const studentTabId = ref<string | null>(null)

  // ==================== E4：实验副本（落盘 + 逐步提交 + 报告） ====================

  /** 当前打开的实验副本（执行面板按 docPath 对号入座）。 */
  const openedLab = ref<OpenedLabRelease | null>(null)
  /** 服务端已受理的步骤记录（stepKey → {passed, score}，/lab/my 口径）。 */
  const labSubmitted = ref<Record<string, { passed: boolean; score: number }>>({})

  /**
   * 打开实验类发布物（purpose≥2）：拉 /lab/copy → 落盘课程工作区 → 以真实
   * docPath 打开 tab → 教师录制 trace 注回引擎（面板定序用）。讲义仍走旧链。
   *
   * 同 releaseId 重开时 main 侧保留本地文件（kept=true）——学生的 todo 回填
   * 成果不因重拉被覆盖；换 releaseId（= 教师发了新版本）才整篇重写。
   */
  const openLabRelease = async(release: StudentRelease): Promise<string> => {
    if (release.purpose === 1) return openStudentRelease(release)
    const res = await window.auth.request<StudentMarkdown>({
      url: '/teaching/lab/copy',
      params: { releaseId: release.releaseId }
    })
    if (!res.ok) {
      return res.error ?? `HTTP ${res.status}`
    }
    const data = res.data
    if (!data?.md) {
      return t('teachingLab.copyEmpty')
    }
    const courseKey = (release.courseCode || release.courseName || 'course').trim() || 'course'
    const fileName = `${(release.materialName || '实验').trim()}.md`
    let put: { docPath: string; kept: boolean }
    try {
      put = await window.teachingWorkspace.labCopyPut({
        courseKey,
        fileName,
        content: data.md,
        releaseId: release.releaseId
      })
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
    // 真实文件 tab（有 docPath）：执行面板、引擎实例、trace 注回全以它为锚。
    window.electron.ipcRenderer.send('mt::open-file', put.docPath)
    if (data.trace) {
      // 双源分离：教师录制序列只进只读定序源，注册表在 60s 宽限重建时原样注回。
      void window.mdcode2run.setTeacherTrace({ docPath: put.docPath, source: data.trace })
    }
    openedLab.value = {
      releaseId: release.releaseId,
      docPath: put.docPath,
      fileName,
      courseKey,
      variant: data.variant ?? '',
      purpose: release.purpose,
      stepOrder: parseStepOrder(data.stepOrder),
      fences: parseFences((data as unknown as { fences?: unknown }).fences),
      closeAt: data.closeAt ?? null,
      kept: put.kept
    }
    labSubmitted.value = {}
    void refreshLabStatus()
    return ''
  }

  /** 服务端已受理的步骤记录（锁序/计分以 t_step_record 为准，这里只读）。 */
  const refreshLabStatus = async(): Promise<void> => {
    const lab = openedLab.value
    if (!lab) return
    const res = await window.auth.request<{
      steps: Array<{ stepKey: string; passed: boolean; score: number }>
    }>({
      url: '/teaching/lab/my',
      params: { releaseId: lab.releaseId }
    })
    const map: Record<string, { passed: boolean; score: number }> = {}
    for (const row of res.data?.steps ?? []) {
      if (row?.stepKey) {
        map[row.stepKey] = { passed: row.passed === true, score: asNumber(row.score) }
      }
    }
    labSubmitted.value = map
  }

  /**
   * 提交一步：passed/traceHit 都来自引擎的通过判定（guardStep 的事实组合），
   * 锁序与计分由服务端裁决——回执 ok=false 时 message 是人话（跳步/缺证据/过期）。
   */
  const submitLabStep = async(
    stepKey: string,
    verdict: { passed: boolean; executed: boolean },
    evidence?: string
  ): Promise<string> => {
    const lab = openedLab.value
    if (!lab) {
      return t('teachingLab.noLab')
    }
    const res = await window.auth.request<{
      ok: boolean
      passed?: boolean
      score?: number
      message?: string
    }>({
      url: '/teaching/lab/step/submit',
      method: 'POST',
      data: {
        releaseId: lab.releaseId,
        stepKey,
        passed: verdict.passed,
        traceHit: verdict.executed,
        ...(evidence ? { evidenceContent: evidence } : {})
      }
    })
    if (!res.ok) {
      return res.error ?? `HTTP ${res.status}`
    }
    void refreshLabStatus()
    return res.data?.ok ? '' : (res.data?.message ?? t('teachingLab.submitRejected'))
  }

  /** 实验报告提交（引擎 labReportOf 拼装的自包含 md；覆盖式，最后一次为准）。 */
  const submitLabReport = async(reportMd: string): Promise<string> => {
    const lab = openedLab.value
    if (!lab) {
      return t('teachingLab.noLab')
    }
    const res = await window.auth.request<unknown>({
      url: '/teaching/lab/report',
      method: 'POST',
      data: { releaseId: lab.releaseId, md: reportMd }
    })
    if (!res.ok) {
      return res.error ?? `HTTP ${res.status}`
    }
    return ''
  }


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

  /**
   * 发题/收卷/进房后重渲染：把对应 slot 换成题目卡或退回占位。
   * E4 起讲义是落盘副本（文件模式），文档内容不随课堂事件重渲染——课堂答题
   * 走答题浮层，这里只对遗留的内存只读流生效（正常路径不会到达）。
   */
  const refreshStudentDocument = async(): Promise<void> => {
    if (openedRelease.value?.docPath) return
    if (!openedRelease.value || !sourceMd.value) return
    const view = renderStudentDocument()
    await openReadOnlyTab(view.md, true)
    void view.slotCount
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
            race.value.closeAt = asServerTime((content.race as Record<string, unknown>)?.closeAt)
            if (!race.value.openedAt) race.value.openedAt = Date.now()
          }
        } else if (role === 'student') {
          classroom.value.role = 'student'
          classroom.value.question = parseQuestion(content.race)
          // 重连时服务端只给当前轮快照，不记得本端是否提交过；按新轮处理，
          // 重复提交会被 uk_open_student 挡成「已提交，不能修改」。
          resetStudentQuizRound(studentQuiz.value)
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
        race.value.closeAt = asServerTime(content.closeAt)
        race.value.answered = 0
        // 还没收到 answered 广播前，浮层也要显示真实在线数；否则在线/已答两个
        // 指标会一起停在 0，看起来像「实况没接上」。
        race.value.online = classroom.value.online || race.value.online
        race.value.reveal = null
        race.value.error = ''
        if (classroom.value.role === 'student') {
          resetStudentQuizRound(studentQuiz.value)
          void refreshStudentDocument()
        }
        break
      }
      case 'teaching.race.accepted': {
        // 只发给提交者：确认服务端已受理，浮层进入「等待揭晓」态。
        studentQuiz.value.submitted = asNumber(content.choice, studentQuiz.value.selected ?? 0)
        studentQuiz.value.error = ''
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
        race.value.closeAt = 0
        // 放映发题浮层（2026-11-16）：host 揭晓后仍要左栏题目+正确项高亮，题快照保留；
        // 学生端维持原语义（题位退回占位）
        if (classroom.value.role !== 'host') {
          classroom.value.question = null
        }
        if (classroom.value.role === 'student') {
          // 保留 submitted：揭晓面板要用「我选了什么」对照正确答案。
          studentQuiz.value.voided = false
          studentQuiz.value.error = ''
          void refreshStudentDocument()
        }
        break
      case 'teaching.race.voided':
        race.value.openId = null
        race.value.questionId = null
        race.value.closeAt = 0
        race.value.answered = 0
        race.value.reveal = null
        classroom.value.question = null
        if (classroom.value.role === 'student') {
          studentQuiz.value.voided = true
          studentQuiz.value.submitted = null
          studentQuiz.value.selected = null
          void refreshStudentDocument()
        }
        break
      case 'teaching.session.taken-over':
        // 同一教师从文枢 Web / 另一文览窗口接管：本端立刻降级为纯放映，
        // 不再持有 host 身份，也不再对同一轮次发 open/close/void。
        if (classroom.value.role === 'host') {
          classroom.value.role = null
          classroom.value.sessionId = null
          classroom.value.error = '本课堂已由另一放映端接管，当前页转为只读放映'
          race.value = emptyRace()
        }
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
        resetStudentQuizRound(studentQuiz.value)
        race.value.closeAt = 0
        race.value.reveal = null
        void refreshStudentDocument()
        break
      case 'teaching.error':
        classroom.value.error = asString(content.message)
        if (race.value.visible) race.value.loading = false
        race.value.error = asString(content.message)
        // 重复提交 / 观战 / 越时等都以 teaching.error 回来，学生浮层要看得见。
        studentQuiz.value.error = asString(content.message)
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
      className: ref.className,
      // 2026-11-15 门户裁决：手动/文档对齐开房也带服务端权威拼装的门户入口，
      // 封面叠码不再只属于 auto 开房一条路
      auto: res.joinUrl
        ? { courseName: '', location: '', joinUrl: res.joinUrl, scheduled: true }
        : null
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

  /**
   * 打开映视图自动确保房间（2026-11-15 裁决）：课表不再是准入门槛，
   * 没排课也照常开房；课表只贡献展示信息（scheduled / 班级 / 教室）。
   * 房间按发布物常驻，手动结束后下次复用同一 sessionId。
   *
   * 四态——none（无任教课程/班，静默）/ hit（已进房，填 classroom.auto
   * 供封面叠码与首页卡）/ multi（多班命中，降级选班）/ no_release（尚未发布讲义，
   * 提示先发布）。message 放 classroom.autoNotice，教学首页卡与映视图封面都会提示，
   * **放映照常**。已在课中不重复调；未登录 / 学生 / 普通用户根本不进本方法。
   */
  const autoStart = async(pathname?: string): Promise<void> => {
    // 短路条件必须同时看 sessionId 与连接态：仅 sessionId 残留（上一次课堂未退出、
    // 连接已断开）时不能短路——否则重新放映不会重进房，发题上行能成但广播收不到
    // （教师端不在房间），浮层停在「等待发题 / 在线0 / 已答0」。
    if (classroom.value.sessionId != null && classroom.value.connected) return
    // 门控（2026-11-15）：只有已登录的教师才检测发布物 / 自动开房。
    // 普通用户（含未登录）与登录的学生一律零请求——不登录也能一文多览。
    const auth = useAuthStore()
    if (!auth.ready) await auth.init()
    if (!auth.state.loggedIn || auth.isStudent) return
    try {
      // 缺口 A（2026-11-15 发题对齐裁决）：当前文档的发布物优先——放映哪份讲义
      // 就开哪份发布物的房，发题列表才与放映内容同源；课表只做「选哪个班」的辅助。
      const localReleases = pathname ? releasesFor(pathname) : []
      const res = await window.teachingSocket.autoHost()
      if (res.ok && res.hit && res.auto) {
        // 课表命中，且命中的班也在当前文档的发布物里 → 换开该文档对应发布物
        const matched = localReleases.find((r) => r.classId === res.auto!.classId)
        if (matched && matched.releaseId !== res.auto.releaseId) {
          const switched = await window.teachingSocket.host(matched.releaseId)
          if (switched.ok && switched.sessionId != null) {
            classroom.value = {
              ...emptyClassroom(),
              sessionId: switched.sessionId,
              role: 'host',
              page: 1,
              releaseId: matched.releaseId,
              className: matched.className || res.auto.className,
              auto: {
                courseName: res.auto.courseName,
                location: res.auto.location ?? '',
                joinUrl: switched.joinUrl ?? res.auto.joinUrl ?? '',
                scheduled: res.auto.scheduled !== false
              }
            }
            reportedPage = 0
            return
          }
        }
        classroom.value = {
          ...emptyClassroom(),
          sessionId: res.sessionId ?? null,
          role: 'host',
          page: 1,
          releaseId: res.auto.releaseId,
          className: res.auto.className,
          auto: {
            courseName: res.auto.courseName,
            location: res.auto.location ?? '',
            joinUrl: res.auto.joinUrl ?? '',
            scheduled: res.auto.scheduled !== false
          }
        }
        reportedPage = 0
        return
      }
      // 多班命中：当前文档恰好只发给其中一个命中班 → 用文档收敛选班，免降级弹提示
      if (
        res.ok &&
        !res.hit &&
        res.notice?.status === 'multi' &&
        res.notice.classId != null
      ) {
        const matched = localReleases.find((r) => r.classId === res.notice!.classId)
        if (matched && (await startClassroom(matched)) === '') return
      }
      // auto 未命中（没排课 / 无发布物 / 静默失败）：当前文档有发布物就照常开房
      if (classroom.value.sessionId == null && localReleases.length > 0) {
        if ((await startClassroom(localReleases[0])) === '') return
      }
      if (res.notice) {
        classroom.value.autoNotice = res.notice.message
        if (res.notice.className) classroom.value.className = res.notice.className
      }
    } catch {
      // 未登录 / 网络 / 服务端异常一律静默：放映绝不被教学检测打扰
    }
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

  /**
   * 拉本讲义可发题目（异步回帧 `teaching.race.question-list`）。
   *
   * 2026-11-15 诚实化：上行失败（未进房/连接未就绪，main 返回明确错误）与回帧
   * 丢失（超时仍 loading）都亮失败态——只有真回帧且列表为空才显示「没有可发的题」。
   */
  const loadRaceQuestions = (): void => {
    race.value.loading = true
    race.value.error = ''
    window.teachingSocket
      .raceQuestions()
      .then((res) => {
        if (!res.ok) {
          race.value.loading = false
          race.value.error = res.error || t('teaching.quizLoadFailed')
        }
      })
      .catch(() => {
        race.value.loading = false
        race.value.error = t('teaching.quizLoadFailed')
      })
    // 回帧可能因为 ws 正在重连而丢掉：超时不再伪装成空列表，亮失败态给重试
    setTimeout(() => {
      if (race.value.loading) {
        race.value.loading = false
        race.value.error = t('teaching.quizLoadTimeout')
      }
    }, 4000)
  }

  /** 缺口 B：deckPane 在 md2s:change 时上报当前页 quiz 标记 id，发题面板据此把本页题置顶。 */
  const setPageQuizKeys = (keys: string[]): void => {
    race.value.pageQuizKeys = Array.isArray(keys) ? keys.filter((k) => typeof k === 'string') : []
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
  const openRaceQuestion = async(question: RaceQuestion, limitSec?: number): Promise<string> => {
    if (classroom.value.role !== 'host') return t('teaching.quizNeedClassroom')
    if (race.value.openId != null) return t('teaching.quizRoundRunning')
    const limit = Math.min(300, Math.max(5, Math.floor(limitSec ?? race.value.limitSec)))
    race.value.limitSec = limit
    race.value.error = ''
    race.value.reveal = null
    race.value.questionId = question.id
    // 2026-11-16 诚实化：上行失败（未进房/连接未就绪）显式报错，不再静默吞掉
    return window.teachingSocket
      .raceOpen(question.id, limit)
      .then((res) => {
        if (!res.ok) {
          race.value.questionId = null
          race.value.error = res.error || t('teaching.quizLoadFailed')
          return race.value.error
        }
        return ''
      })
      .catch(() => {
        race.value.questionId = null
        race.value.error = t('teaching.quizLoadFailed')
        return race.value.error
      })
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

  /**
   * 学生端：拉派生 md（讲义=reading，含不可见的 quiz-slot 注释标记），落盘课程
   * 工作区并以真实 docPath 打开——E4 起讲义是**可写副本**（学生加笔记批注），
   * 「还原服务端版本」强制重拉覆盖（发布定格：服务端是卷面权威）。课堂答题
   * 走答题浮层（ws → studentQuiz），文档内容不随课堂事件重渲染。
   */
  const openStudentRelease = async(release: StudentRelease): Promise<string> => {
    if (release.purpose !== 1) return openLabRelease(release)
    const res = await window.auth.request<StudentMarkdown>({
      url: '/teaching/student/release/markdown',
      params: { releaseId: release.releaseId }
    })
    if (!res.ok) {
      return res.error ?? `HTTP ${res.status}`
    }
    const data = res.data
    if (!data?.md) {
      return t('teachingLab.copyEmpty')
    }
    const courseKey = (release.courseCode || release.courseName || 'course').trim() || 'course'
    const fileName = `${(release.materialName || '讲义').trim()}.md`
    let put: { docPath: string; kept: boolean }
    try {
      put = await window.teachingWorkspace.labCopyPut({
        courseKey,
        fileName,
        content: data.md,
        releaseId: release.releaseId
      })
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
    window.electron.ipcRenderer.send('mt::open-file', put.docPath)
    openedRelease.value = {
      releaseId: release.releaseId,
      materialName: release.materialName,
      courseName: release.courseName,
      purpose: release.purpose,
      versionNo: release.versionNo,
      variant: data.variant ?? 'reading',
      docPath: put.docPath,
      fileName,
      courseKey,
      kept: put.kept
    }
    void joinClassroom(release.releaseId)
    return ''
  }

  /**
   * 「还原服务端版本」（教学菜单 / 命令面板）：当前打开的课程文档（实验副本或
   * 讲义笔记）强制重拉覆盖——发布定格下服务端是卷面权威，本地只是作答面。
   */
  const restoreCurrentDoc = async(): Promise<string> => {
    const reopen = (docPath: string): void => {
      const editor = useEditorStore()
      const current = editor.currentFile
      if (current && current.pathname === docPath) editor.FORCE_CLOSE_TAB(current)
      window.electron.ipcRenderer.send('mt::open-file', docPath)
    }
    const lab = openedLab.value
    if (lab) {
      const res = await window.auth.request<StudentMarkdown>({
        url: '/teaching/lab/copy',
        params: { releaseId: lab.releaseId }
      })
      if (!res.ok) return res.error ?? `HTTP ${res.status}`
      const put = await window.teachingWorkspace.labCopyPut({
        courseKey: lab.courseKey,
        fileName: lab.fileName,
        content: res.data?.md ?? '',
        releaseId: lab.releaseId,
        force: true
      })
      reopen(put.docPath)
      return ''
    }
    const rel = openedRelease.value
    if (rel?.docPath) {
      const res = await window.auth.request<StudentMarkdown>({
        url: '/teaching/student/release/markdown',
        params: { releaseId: rel.releaseId }
      })
      if (!res.ok) return res.error ?? `HTTP ${res.status}`
      const put = await window.teachingWorkspace.labCopyPut({
        courseKey: rel.courseKey,
        fileName: rel.fileName,
        content: res.data?.md ?? '',
        releaseId: rel.releaseId,
        force: true
      })
      reopen(put.docPath)
      return ''
    }
    return t('teachingLab.noLab')
  }

  // ==================== 学生作答（E5 步 4） ====================

  const openStudentQuiz = (): void => {
    if (classroom.value.role !== 'student') return
    studentQuiz.value.visible = true
  }

  const closeStudentQuiz = (): void => {
    studentQuiz.value.visible = false
  }

  const selectStudentOption = (index: number): void => {
    if (studentQuiz.value.submitted != null) return
    studentQuiz.value.selected = index
  }

  /** 提交的是本班显示序下标；服务端还原并判分，回执走 teaching.race.accepted。 */
  const submitStudentAnswer = (choice?: number): void => {
    if (classroom.value.role !== 'student') return
    const openId = race.value.openId
    if (openId == null) return
    if (studentQuiz.value.submitted != null) return
    const target = choice ?? studentQuiz.value.selected
    if (target == null || target < 0 || target > 5) {
      studentQuiz.value.error = t('teaching.studentQuizSelectFirst')
      return
    }
    studentQuiz.value.selected = target
    studentQuiz.value.error = ''
    void window.teachingSocket.raceAnswer(openId, target)
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
    studentQuiz,
    openStudentQuiz,
    closeStudentQuiz,
    selectStudentOption,
    submitStudentAnswer,
    openPublish,
    closePublish,
    openStudentRelease,
    joinClassroom,
    leaveClassroom,
    startClassroom,
    endClassroom,
    autoStart,
    reportPage,
    setFollowLocked,
    openQuizConsole,
    closeQuizConsole,
    loadRaceQuestions,
    setPageQuizKeys,
    openRaceQuestion,
    closeRaceRound,
    voidRaceRound,
    releasesFor,
    metaFor,
    remember,
    restoreLast,
    openedLab,
    labSubmitted,
    restoreCurrentDoc,
    openLabRelease,
    submitLabStep,
    submitLabReport,
    refreshLabStatus
  }
})
