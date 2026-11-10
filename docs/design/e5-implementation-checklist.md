# E5 实施清单（edu-client · 教师侧）

> 定位：E5「写得完、发得出、放得上、跑得动」的**可执行任务清单**——把 D7/D8/D9
> 的设计落到具体文件、接口与验收用例。E5 是 E6 的底座，本清单**不含** E6 的全量
> 管理页面（课程/班级/名单/题库/成绩册/平台管理）。
>
> 互引：`edu-client-design.md`（§2 三路由、§4.1、§5.4、§8 D7/D9、§9 E5/E6）、
> `course-workspace-design.md`（§2 目录骨架、§9 图片资产协议 D8）、
> `ARCHITECTURE.md` v0.18（§10 E5/E6、ADR-14/21）。
>
> 状态：**步骤 1（桌面侧）+ D10 叠加态骨架 + 学生侧只读投影/课堂跟随 + 教师侧开班上报与发题控制台已实现**
> （2026-11-09 起分批落地，最近一次 2026-11-10；每轮 `pnpm minify-locales` /
> `pnpm typecheck` / `pnpm lint` / `vitest` 均通过）。步 2–3、步 4 的学生作答与揭晓态、
> 步 5 讲台执行仍待实施。基线接口名与文件路径以本地代码为准。
>
> **形态前提（D10 / ADR-22，2026-11-09 定稿；同日 20:28 细化）**：教育功能是
> **叠加态**——通用文览 `EDITOR / /editor` 与教育版文览 `TEACHING / /teaching`
> 两个实例共用同一套布局。**不做大面积布局重构**：左下登录入口、右下视图切换、
> 顶部菜单栏一律保留原样，教育功能只在现有元素上叠加（菜单项 / 「教学」tab
> 独立树 / 状态栏指示），**两棵独立树、互不混根**；不新增常驻右侧面板、不改壳、
> 不加第三窗口类型。

## 0. 一页速查

| 步    | 交付                                                                                                                                                           | 前置                     | 性质                             |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------- |
| **0** | **布局零重构**：确认现有布局锚点（左下登录、右下 `viewSwitcher`、顶部菜单栏）并在其上叠加教育入口；**不**把 `/teaching` 改挂 `app.vue`、**不**新建常驻右侧面板 | 无                       | D10 细化的硬约束                 |
| 1     | 纯文本讲义「发布到文枢…」最小闭环（含三入口操作路径 + **版本决策**）                                                                                           | 步 0（复用 E1 通道）     | **先做**：定下 E6 共用的通道范式 |
| 2     | 带图讲义：D8 资产收集 + 两阶段上传                                                                                                                             | 步 1 + 服务端 DDL/接口   | 重，跨桌面与服务端               |
| 3     | 课程工作区骨架（`projectsRoot` / `doc                                                                                                                          | code`/`img`）            | 步 2 的图片路径基准              | 本地文件系统 |
| 4     | 课堂会话与发题（**放映复用主窗口「映」叶**，不建窗口、不建 deck 宿主）                                                                                         | 步 1 的发布物 id、M2b ws | 控制条 + ws                      |
| 5     | 讲台执行（文运 IPC，挂在「映」叶）                                                                                                                             | 步 4 的课堂会话          | ADR-14，不判分                   |

## 1. 基线：已有什么（代码核实）

| 层                                      | 已有                                                                                                                                                                                                                                                                                                                                                                                                                                         | 位置                                                                                                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 登录与请求代理                          | `AuthManager`：token 经 `safeStorage` 加密落盘 `userData/auth.json`；`request()` 注入 `Authorization` + `tenant-id`、401 自动刷新重试一次、解包 `CommonResult`                                                                                                                                                                                                                                                                               | `packages/desktop/src/main/auth/index.ts`                                                                                                                  |
| IPC 通道                                | `ipcMain.handle('auth::request'                                                                                                                                                                                                                                                                                                                                                                                                              | 'auth::login'                                                                                                                                              | ...)` 已注册 | `src/main/ipc/auth.ts`                                                          |
| renderer 入口                           | `window.auth.request<T>({ url, method, data, params, anonymous })`，contextBridge 暴露 `auth`                                                                                                                                                                                                                                                                                                                                                | `src/preload/index.ts:337`；用法见 `src/renderer/src/pages/teaching.vue:148`                                                                               |
| 通道类型                                | `IpcInvokeChannels` 中 `'auth::request'` 等已声明                                                                                                                                                                                                                                                                                                                                                                                            | `src/shared/types/ipc.ts:73`、`src/shared/types/auth.ts`                                                                                                   |
| 窗口工厂                                | `TeachingWindow`（`WindowType.TEACHING`）+ `/teaching` 路由；`routes(envType)` 按窗口类型给默认路由（`/editor` → `App`，`/teaching` → `Teaching`）                                                                                                                                                                                                                                                                                           | `src/main/windows/teaching.ts`、`src/main/windows/base.ts:16`、`src/renderer/src/router/index.ts:25`                                                       |
| **两实例现状（D10 细化：不重构布局）**  | 两实例技术已成立（`WindowType.EDITOR` / `TEACHING`，同 bundle + main auth 单例）。**布局以现有 `app.vue` 为准**：左侧栏（顶部「文件/大纲」tab + 树 + **左下「登录」**）、中间编辑区、底部细状态栏（**右下 `viewSwitcher` 刻度「本 文 栏│页 览 映 · 表 图 码」** + 页宽滑块）、**顶部菜单栏**（Alt 唤出）。`/teaching` 的 `teaching.vue` 课程/讲义列表作为侧栏内容来源复用，**不要求换壳重挂、不新增常驻右侧面板**                            | `src/renderer/src/pages/app.vue:17`、`src/renderer/src/pages/teaching.vue`、`src/renderer/src/components/viewSwitcher/index.vue`                           |
| 只读讲义                                | `teaching/reader.vue`（muya `readOnly`）                                                                                                                                                                                                                                                                                                                                                                                                     | `src/renderer/src/components/teaching/reader.vue`                                                                                                          |
| **deck 放映（已完整可用）**             | 「览」(`slide`)/「映」(`present`) 两叶共用 `deckPane.vue`：main 起**本地 md2slides 服务**（vendored 资产包），iframe 指 `服务/deck.html`，postMessage 传 `build{md, mdDir}`；`allowRoots:[mdDir]` 图片白名单、换文档重启服务；`enterPresentImmersive()` 一键全屏；已支持图片型/可编辑型 PPTX 导出                                                                                                                                            | `src/renderer/src/components/editorWithTabs/deckPane.vue`、`src/main/ipc/md2slides.ts`、`src/renderer/src/store/editorView.ts`、`src/preload/index.ts:298` |
| 服务端发布链                            | `POST /teaching/material/create`、`PUT /teaching/material/update-content`、`POST /teaching/release/create`（`ReleaseServiceImpl#createRelease` 串 `/v1/parse` → fm 校验 → 拆题 → 发布物）                                                                                                                                                                                                                                                    | `wenshu-module-teaching/.../controller/admin/material                                                                                                      | release/`    |
| **发布对话框下拉（已核实 2026-11-09）** | `GET /teaching/course/simple-list` → `List<{id,name}>`（无参，仅开启状态）；`GET /teaching/class/simple-list?courseId=` → `List<{id,name,courseId}>`（courseId 可空，仅开启）；`GET /teaching/material/simple-list?courseId=` → 讲义精简列表；`GET /teaching/material/version/list?materialId=` → 版本列表；`GET /teaching/material/get?id=` → `MaterialDetailRespVO`（含 `currentVersionId`）。三者均带 `@PreAuthorize('teaching:*:query')` | `.../controller/admin/course                                                                                                                               | clazz        | material/`、`wenshu-ui-admin/src/api/teaching/{course,class,material}/index.ts` |
| 服务端放映页                            | `GET /teaching/preview/presentation?...` 返回**裸 HTML**；服务浏览器兜底 / 运维，**E5 教师放映不走这条**（走本地映叶）                                                                                                                                                                                                                                                                                                                       | `.../controller/admin/preview/PreviewController.java:46`                                                                                                   |
| 文件上传                                | `POST /infra/file/upload`（multipart，`FileUploadReqVO{file,directory}`）→ `CommonResult<String>` **文件 URL**                                                                                                                                                                                                                                                                                                                               | `yudao-module-infra/.../admin/file/FileController.java:46`                                                                                                 |
| 服务地址                                | 默认 `http://localhost:48080`，`WENSHU_BASE_URL` 可覆盖；前缀 `/admin-api`                                                                                                                                                                                                                                                                                                                                                                   | `src/main/auth/index.ts:28-30`                                                                                                                             |
| 引擎                                    | md2slides deck 前端、文运 mdcode2run 引擎本体                                                                                                                                                                                                                                                                                                                                                                                                | `md2slides/`、`mdcode2run/`                                                                                                                                |

## 2. 零代码清单（本清单要新建的）

- [ ] 顶部菜单栏加「教学」菜单（发布到文枢…、课堂/发题、成绩册…），**Alt 唤出机制与原有菜单项一律保留**
- [ ] 左侧栏加「教学」tab（与「文件/大纲」并列），**内为课程工作区独立树**：`{course}/doc/ | img/ | code/`，切 tab 换树、**不与常规 `openFolder` 根混根**，RBAC 裁剪。coursework 不进任何树。**左下「登录」入口复用**，登录后就地变成身份标识，不另加账号条
  - 落点（已核实）：`store/layout.ts` 的 `SidebarTab = 'files' | 'toc'` 加 `'teaching'`，**`normalizeSidebarTab()` 必须同步放行**（现为 `tab === 'toc' ? 'toc' : 'files'`，否则持久化的 `'teaching'` 会被归一成 `'files'`）；`sideBar/index.vue` 的 `sideBarTabs` 加一项 + `v-else-if` 挂教学树组件；`tree.vue` 已有 `sidebarTab !== 'files'` 判断，教学 tab 下常规树自然隐藏。
- [ ] 底部状态栏加教育状态指示（讲义版本 / 发布状态 / 课堂状态）；**右下 `viewSwitcher` 原样不动**
- [ ] 主窗口「发布到文枢…」动作 + 发布对话框（菜单项 / i18n / UI）
- [ ] 发布相关 IPC 调用封装（复用 `window.auth.request`，不新建鉴权通道）
- [ ] 图片引用收集器 + 内容哈希 + 二进制上传通道
- [ ] `projectsRoot` 配置、根锚点 `.wenlan/workspace.json`、课程目录惰性创建
- [ ] 服务端：`t_material_asset` 表、`assets` 字段、资产上传接口、引用完整性校验
- [ ] 课堂会话 / 发题 / 揭晓控制条（挂载位置见 §5.2）
- [ ] mdcode2run 讲台模式 + 「映」叶 IPC 调用
- [ ] 教师**管理**能力（E6）：做成教育版实例壳内的面板/路由页，**不新建窗口类型**（D10）

## 3. 五步实施

### 步骤 1 · 纯文本发布最小闭环（先做）

**目标**：教育版实例里打开一份 md → 点「发布到文枢…」→ 服务端生成版本与发布物；错误原样呈现。此步**不碰图片**。

#### 1.1 入口（最小叠加，不新增常驻控件）

发布对话框是**模态浮层**（`rename` / `import-modal` 同族），关闭后界面回到原样。三个入口全部挂在现有元素上：

| 入口             | 触发                                                  | 实现落点                                                      |
| ---------------- | ----------------------------------------------------- | ------------------------------------------------------------- |
| 文件树右键（主） | `▾ MD` 里右键某个 `.md` → 「发布到文枢…」，预填该文件 | `components/sideBar/treeFile.vue` 已有 `contextmenu`          |
| 命令面板         | `Ctrl+Shift+P` → 搜「发布到文枢」，作用于当前文档     | `components/commandPalette/index.vue` + `store/commandCenter` |
| 顶部「教学」菜单 | Alt 唤出菜单栏 → 教学 → 发布到文枢…                   | `main/menu/index.ts` 加子菜单，走 `mt::menu::execute`         |

左下身份菜单、状态栏左侧 `v3 已发布` 指示也可点开同一对话框。**仅登录态可见**（N1：未登录零教学概念）；新增 i18n 键 12 语言全加 + `pnpm minify-locales`。

#### 1.2 操作流程

1. **前置检查**：已登录、有当前 md、无未保存改动；不满足则命令禁灰并给提示。
2. **打开发布对话框**：默认当前文档；右键进来预填那个文件。
3. **填写**：讲义（新建 = 名称 + 课程，或更新已有 → `GET /teaching/material/simple-list?courseId=`）、课程（`GET /teaching/course/simple-list`）、教学班（`GET /teaching/class/simple-list?courseId=`，随所选课程联动）、用途（1 资料查阅 / 2 机房实训 / 3 作业 / 4 测试 / 5 考试）、**版本选择（见 1.3）**。三条下拉都走 `window.auth.request`，返回 `{id, name}`（教学班多 `courseId`），且只含「开启」状态条目。
4. **点「发布」**：对话框分步显示进度（保存正文 → 创建版本 → 创建发布物）；此步无图片，步 2 再插「上传图片 N/M」。
5. **错误处理**：服务端错误（fm 缺 `course`、quiz id 课程内撞车、`ID_MISSING`、`MATERIAL_VERSION_NOT_EXISTS`）按 `AuthRequestResult.error` 原样呈现，客户端不做教学校验、不本地猜。
6. **成功后**：状态栏左侧由「未发布」变 `v3 已发布 · 2 个班`；对话框给「预览放映」（直接进「映」叶本地 deck 服务）与「复制学生链接」。发布物 id 存本地元数据，**不写回 md**。

#### 1.3 版本决策（本步核心）

> 版本**不是发布时生成的**，是「保存正文」时生成的；发布只是**挑一个已有版本锚定**。

**服务端机制（已核实 2026-11-09）**：

| 动作                                                  | 结果                                                                                                                                                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /teaching/material/create`                      | 建讲义 + v1（`versionNo=1`）；**只返回 `materialId`，不返回 `versionId`**                                                                                                                 |
| `PUT /teaching/material/update-content {id, content}` | **无条件**新建一版：`versionNo = max(versionNo)+1`（`MaterialVersionMapper.orderByDesc` 取首条），`content` 全量副本、旧版永不覆盖，`current_version_id` 指针前移；**返回新 `versionId`** |
| `POST /teaching/release/create`                       | `materialVersionId` **`@NotNull` 必填**，服务端不自动取 `currentVersionId`；查版本校验「存在 + 属于该讲义」，用 **`version.getContent()` 快照**跑 `/v1/parse` → fm 校验 → 拆题 → 写发布物 |

**服务端不比对内容**：md 一字未改，调一次 `update-content` 也 +1 版。

**三种场景**：

| 场景                                           | 客户端动作                                                                                                   | 接口                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------- |
| 改了稿，发新版                                 | `update-content` 拿新 `versionId` → 发布                                                                     | 2 步                  |
| 同一版发第二个班 / 上次发布失败重试 / 重发旧版 | **复用**已有 `versionId`（本地记住，或 `GET /teaching/material/version/list` 选）                            | 只调 `release/create` |
| 新建讲义首次发布                               | `create` 拿 `materialId` → `GET /teaching/material/get?id=` 取 `currentVersionId`（或 `version/list`）→ 发布 | 3 步                  |

**对话框的「版本」区**：默认「用当前内容新建版本」（显示将生成 vN）；另有下拉「复用已有版本」（列 `v3 · 日期 · 已发 2 班`）。多选班级时循环调 `release/create`，**共用同一个 `versionId`**，不重传正文、不重建版本。

**两个硬约束**：

1. **防垃圾版本**：客户端保存上次发布的内容 hash，与当前 md 比对；相同且教师未勾「强制新建」→ 复用旧 `versionId`，只调发布接口。**别把「每次点发布都 `update-content`」写进实现**。
2. **防重复发布物 / 并发撞号**：`t_release` 无 `(material_version_id, class_id)` 唯一约束、`t_material_version` 无 `uk(material_id, version_no)`；发布按钮禁用 + loading 防连点，并发两次 `update-content` 会算出同一 `versionNo`。M2a 冒烟测的「重复发布幂等」是 `alignQuestions` 拆题幂等，**不等于发布物去重**。

#### 1.4 改动文件与验收

- [ ] 改动文件：`main/menu/index.ts`（教学子菜单）、`components/sideBar/treeFile.vue`（右键项）、`store/commandCenter`（命令注册）、`src/renderer/src/` 新建发布对话框组件、状态栏指示；`src/preload/index.ts` / `shared/types/ipc.ts` 若需新类型。全部请求走 `window.auth.request`。

**验收**：

- [ ] 未登录时三处入口均不出现；登录后出现；无当前文档 / 未保存时禁灰。
- [ ] 纯文本 md 一键发布 → DB 出现新 `t_material_version` 行与 `t_release` 行，版本号递增、旧版本不覆盖。
- [ ] 内容未改再点发布 → **不新增版本**，只新增发布物（同版发第二班）。
- [ ] 发布后改稿建 v4 → 已发班级仍读 v3 快照。
- [ ] 故意写缺 `course` 的 fm / 撞车 quiz id → 对话框显示服务端原错误，不静默、不本地猜。
- [ ] 连点发布按钮不产生重复发布物。
- [ ] 全部请求经 `window.auth.request`，renderer 内存里搜不到 `access_token`。

**不做**：图片、课程工作区、放映、讲台执行、任何管理页面。

### 步骤 2 · 带图讲义（D8 资产协议）

- [ ] **客户端收集器**：解析当前 md，扫 `![]()` 与手写 `<img src>`（`parse/markdown.js` 开 `html:true`）；路径白名单只收相对路径，禁 `..`、绝对路径、`http(s)`；按 sha256 去重；清单**内存生成不落本地**。
- [ ] **二进制上传通道**：`auth::request` 写死 `Content-Type: application/json` + `JSON.stringify(data)`，发不了 multipart。二选一（待决 §5.4）：给 `AuthRequestOptions` 加 `raw`/FormData 分支，或单开 `auth::upload` 通道（main 侧读文件、拼头，token 仍不出 main）。
- [ ] **服务端**：新建 `t_material_asset`（或等价表）按 `material_version_id` 锚定；`MaterialContentUpdateReqVO` 与 `MaterialSaveReqVO` 加可选 `assets: [{ path, assetId, sha256, mime, size }]`；`MaterialServiceImpl` 在同一事务校验「每个引用都在清单里、每个 assetId 存在」，**缺图拒发并报具体文件名**；资产只增不改。
- [ ] **放映/PPTX 链路**：放映页把 `img src` 换成版本化 URL；导出 PPTX 前把资产落回本地临时目录喂 `export/pptx/media.js`（它**不认 `http(s)`**，会当本地路径判「图片不存在」）。
- [ ] 单图 / 单版本体积上限；超限提示压缩（截图转 webp）。

**验收**：

- [ ] 缺一张图 → 拒发，错误信息含该文件名（对齐 quiz 缺 `answer` 口径）。
- [ ] 带图讲义发布后，学生只读投影、放映页、PPTX 导出**三处图片都在位**。
- [ ] 同一张图被两份讲义引用 → 服务端只存一份；改版不产生重复资产。
- [ ] 纯文本讲义（不传 `assets`）走老路径零回归。

### 步骤 3 · 课程工作区骨架（E3.0）

- [ ] `projectsRoot` 配置项（默认 `~/WenlanProjects`），登录后校验存在性 → 缺失弹引导选择/创建；非教育用户默认跳过。
- [ ] 根锚点 `{projectsRoot}/.wenlan/workspace.json` `{ schemaVersion:1, kind:'course-workspace' }`。
- [ ] 首次进入课程惰性创建 `{course}/doc/`、`{course}/code/`，课程名 `course.code` 优先、回退 name slug；图片落 `img/{materialName}/`。
- [ ] `projects` 根可进常规文件树（`openFolder`）；`doc/` 学生侧挂只读锁。

**验收**：目录结构与 `course-workspace-design.md` §2 一致；学生侧 `doc/` 连同 `img/` 只读；`code/` 可写；根锚点可用于重定位。

### 步骤 4 · 课堂会话与发题（放映复用「映」叶）

> **校正（2026-11-09）**：文览主窗口的「映」(`present`) /「览」(`slide`) 两叶
> **本身就是 deck 放映器**——`deckPane.vue` 由 main 起本地 md2slides 服务、
> iframe 加载 `deck.html`、postMessage 传 `build{md, mdDir}`，`enterPresentImmersive()`
> 一键全屏。因此 E5 **不新建放映窗口、不新建 deck 宿主、不拉服务端
> `/teaching/preview/presentation` 裸 HTML**。本地服务已按 `mdDir` + `allowRoots`
> 直出相对路径图片，D8 的图片在教师本地放映里天然可用。

- [x] 课堂会话（M2b ws，`/infra/ws?token=`，**上行 content 必须二次序列化**）按 `releaseId` 开会话。
      **已实现（2026-11-10，教师侧"发"的一半）**：入口是状态栏教学指示旁的 `el-dropdown`
      （未开课列出发布过的班；开课显示「● 课堂中 · 班名 · 第 N 页 · 在线」+ 锁定跟随/结束课堂），
      另加 `teaching.classroom` 命令与「教学」菜单项。main 侧 `teachingSocket.host()` 先
      `GET /class-session/get` 复用进行中会话、没有才 `create`；`md2s:change` → 上行
      `teaching.session.page`（按页号去重）。教师也 join 同一房间，故 `followTargetOf`
      对 `role === 'host'` 恒不跟随。**边界**：页码只在「映/览」叶活动时上报（「页」叶不上报）；
      发题/揭晓仍属步骤 4 余下部分。
- [x] 发题 / 揭晓 / 大屏榜单控制条（**模态浮层 `quizConsole.vue`，非常驻面板**）。
      **已实现（2026-11-10，教师侧发题闭环）**：入口为状态栏课堂下拉「发题…」、
      「教学」菜单与 `teaching.quiz` 命令（三处同开一个 el-dialog）。协议全部走 ws：
      上行 `teaching.race.questions / open / close / void`（main 侧白名单封装，renderer
      发不出任意帧），下行 `question-list`（host 专用）/`opened`/`answered`/`revealed`/`voided`。
      控制台含：题目列表（`questionKey`/题干/分值，本讲义原供题）、限时输入（5–300s）、
      进行中倒计时与已答进度、收卷揭晓、作废、揭晓面板（正确答案 / 分布条形 / 最快 /
      排行榜前 8）。倒计时用本地 `openedAt` 推算，不解析服务端无时区时间串。
      **RBAC**：`openQuizConsole()` 非 host 直接返回提示，学生端看不到入口。
- [ ] 学生端作答提交（`teaching.race.answer`）与揭晓态渲染：现在学生收到 `revealed`
      只把题目卡退回占位，答案与得分不下发到界面。
      **服务端乱序 bug 已修（2026-11-10，wenshu-server `1530673`）**：
      `RaceServiceImpl#revealedContent` 原按讲义原始序下发 `options` / `answer` /
      `distribution`，而 `opened` 按本班 `option_order` 打乱，`shuffle=yes`（默认）时会出现
      「学生选 D 判对、揭晓却宣布答案是 B」。现把揭晓**展示层**按 `option_order` 投影到
      显示序（落库 `submitted_answer` 与判分仍保持原始序，跨班统计口径不变），发题与揭晓
      共用 `projectToDisplayOrder`；新增 `RaceRevealOrderTest` 6 例与 `m2b-race-check.js`
      的「选项顺序一致 / 答案字母指向正确文本」回归断言。
- [x] 翻页/步进与 wenshu 放映页行为对齐（deck 播放器已具备，只需接会话状态）；教师放映不依赖浏览器，学生 H5 与任意浏览器查阅不变。
      **已实现（2026-11-10）**：教师 `md2s:change` → `teaching.session.page`；学生
      `teaching.session.page` → `md2s:follow` → `player.go(page)`，锁定时空的学生导航键、
      未锁时 800ms 冷却回弹。两端同一套 `classroomFollow` 判定（host 恒不跟随）。
- [ ] 管理分区**推迟到 E6**；E5 只叠加课堂会话/发题入口（菜单项或侧栏 tab），不新建窗口类型、不新增常驻面板（D10）。

**验收**：点「映」直接全屏放映本地 md（含相对路径图片、图表、公式）；教师能按 `releaseId` 开会话、翻页、发题；学生账号看不到发题控制条；全程不经服务端 presentation HTML。

### 步骤 5 · 讲台执行（ADR-14，挂在「映」叶）

- [ ] mdcode2run 讲台模式：纯执行、无判分；由「映」叶放映态经 IPC 调用，**不开本机端口**（deck 是跨源 iframe 里的 postMessage 客户端，碰不到 IPC，须由 renderer 侧代理转发）。
- [ ] 只执行当前登录教师自己的讲义版本；不判分、不进成绩册。

**验收**：代码块现场运行上大屏；成绩册零变化；执行失败有可读提示且不影响放映。

## 4. 全局硬规矩（踩过的坑）

| 规矩                                                                               | 原因                                                                                                                                                      |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 所有 admin-api 请求走 `window.auth.request` / main 侧新通道，renderer 不直接 fetch | token 只活 main（`safeStorage`），讲义开 `html:true` 有 XSS 面                                                                                            |
| 二进制上传另开通道                                                                 | `rawRequest()` 写死 JSON + `JSON.stringify(data)`                                                                                                         |
| 图片只认相对路径，禁 `..` / 绝对 / `http(s)`                                       | `media.js` 不认 http；对齐 mdcode2run `file=` 口径；断网机房可用                                                                                          |
| **本地「映」叶与服务端放映页是两条图片路径**                                       | 本地：`mdDir` + `allowRoots` 由本地服务直出相对路径图，**无需改写 src**；只有**服务端放映页 / 学生 H5 / 服务端 PPTX 导出**才需换版本化 URL 或落回临时目录 |
| `![]()` 与 `<img src>` 都扫                                                        | markdown.js `html:true`，手写标签是合法讲义内容                                                                                                           |
| 缺图拒发并报文件名                                                                 | 不静默下发无图讲义                                                                                                                                        |
| pre-commit 只跑 eslint/prettier，改完**手动 `vue-tsc`**                            | CI 无 prettier 门；类型错只能本地抓                                                                                                                       |
| main 产物改动**重启 `pnpm dev`**；muya 改动先 build muya                           | 热更不覆盖 main / 子包产物                                                                                                                                |
| vite dev 不做源码 CJS 互操                                                         | renderer 新增 CJS 源文件 = dev 必炸，生产 e2e 测不出                                                                                                      |
| 新增 i18n 键 12 语言全加 + `pnpm minify-locales`                                   | 平键校验单测会逼；运行时优先 `.min.json`                                                                                                                  |
| e2e 构建须 `NODE_ENV=production`                                                   | 否则 baseUrl 取空 `ELECTRON_RENDERER_URL` → Invalid URL                                                                                                   |

## 5. 动手前待拍板

1. **assetId vs URL**：D8 设计写 `assetId`，但现成 `POST /infra/file/upload` 只返回文件 URL 字符串、无 id。要么新增包装接口返回 `{assetId, sha256, url}`，要么把 URL 直接当资产标识——需定一个。
2. **发题/会话入口挂哪**：**已定（2026-11-10）**——课堂会话与发题都是**模态浮层**（`el-dropdown` + `el-dialog`），入口为状态栏课堂下拉、「教学」菜单与命令面板三处，**不做常驻右侧面板**（会改布局）。放映本身复用「映」叶，不再讨论 presentation 裸 HTML 承载——服务端放映页只服务浏览器兜底 / 运维，不进 E5 主路径；也不新建独立管理窗口（D10）。
3. **教师账号的查询权限（唯一剩余风险）**：三个下拉接口都带 `@PreAuthorize`——`teaching:course:query` / `teaching:class:query` / `teaching:material:query`；教师 RBAC 角色是否默认具备这三项、缺权限时是补授权还是走匿名精简接口，需与服务端菜单授权核对（否则下拉 403）。**接口路径与 VO 字段已全部核实**（见 §1 基线表），「是否允许新建讲义」也已由 §3 步骤 1.3 定为三种场景之一，均不再是待决项。
4. **二进制通道形态**：扩 `auth::request` 加 FormData 分支，还是单开 `auth::upload`。
5. **生产地址**：`WENSHU_BASE_URL` 现在默认 `localhost:48080`，打包后须由配置/安装器给出中心服务器地址。
6. **跨源 iframe 的 IPC 转发边界**：deck 页内 `exec-present.js` 是纯 postMessage 客户端、碰不到 IPC；讲台执行（步 5）与发题控制（步 4）都要由 renderer 侧代理转发，消息协议需先定。deck 在 Electron 内已由「映」叶跑通，无需再做兼容性 Spike。

## 6. E5 / E6 边界

- E5 只做**发布 / 放映 / 讲台**这条教师工作流；发布对话框里的「选课程、选班级」下拉属于 E5 的最小依赖，不算 E6 管理页面。
- E6 承担课程/班级/名单/版本/发布物/题库/成绩册/平台管理的**原生页面**；步骤 1 定下的 `window.auth.request` 调用范式与错误呈现组件由 E6 直接复用。
- 过渡期 `wenshu-ui-admin` 作运维/应急备用，不留能力真空。

## 7. Definition of Done

- [ ] 步 1–5 验收项全绿；纯文本与带图讲义两条路径都有 e2e 用例。
- [ ] 教师从写 md 到放映、现场执行全程不打开浏览器；学生侧零安装不变。
- [ ] 教师放映走主窗口「映」叶的本地 md2slides 服务，不经服务端 presentation HTML；带图讲义本地放映图片在位。
- [ ] 全部网络请求经 main 代理，renderer 不持有 token。
- [ ] 新增 i18n 键 12 语言齐、`vue-tsc` 无错、`pnpm minify-locales` 已跑。
- [ ] 服务端 `t_material_version`「一份 md + 一份不可变资产清单 = 一个版本」语义落实，旧版本不覆盖。
