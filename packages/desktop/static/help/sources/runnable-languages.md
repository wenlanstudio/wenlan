# 代码运行语言示例

> 本仓库自带的**可运行参照**：一份 Markdown 演示执行窗支持的全部 7 种运行语言，
> 每种给一段示例开栏写法与预期结果。这里是**查阅版**；要真跑，把示例复制到自己的
> 讲义里并按下面配好执行环境。

## 前置配置（`code-exec`）

执行环境写在文档**顶部**的 YAML front-matter `code-exec:` 段，换机器只改这里的路径。
密码不写进讲义（只在引擎配置层）：

```yaml
code-exec:
  session-boundary: h1
  java:
    JAVA_HOME: "<JDK 根目录或 bin>"
  python:
    PYTHON_PATH: "<python.exe 路径>"
  mysql:
    HOST: 127.0.0.1
    PORT: 3306
    USER: root
    DATABASE: "<库名>"
```

键的完整清单见本帮助窗的「代码运行 · mdcode2run」（`FRONTMATTER.md`）。

**运行前提**：

| 语言族 | 围栏标记 | 解释器 | 前置 |
| --- | --- | --- | --- |
| python | `python` `py` | Anaconda | `code-exec.python.PYTHON_PATH` |
| java | `java` `jshell` | JDK 17 | `code-exec.java.JAVA_HOME` |
| shell | `bash` `sh` `shell` | Git Bash 或 WSL | 装其一；WSL 要配 `RUNTIME: wsl` |
| powershell | `powershell` `pwsh` `ps1` | Windows PowerShell 5.1 | 系统自带 |
| mysql | `sql` `mysql` | mysql 客户端 | 客户端在 PATH + 数据库可连 |
| hive | `hive` `hql` `hiveql` `sparksql` | beeline | HS2 可连 |
| file | `file=<路径>` | **不执行语言**，点 ▶ 写盘 | 无 |

**三条通则**：

1. **章 = 会话边界**：同一 `#` 章节内，`python` / `java` 的多次运行共享命名空间（变量、import 一直留着）；`h1` 换章就换会话。
2. **`shell` / `powershell` / `sql` / `hive` / `file` 是一次性**：跑完即断，靠数据（文件、数据库表）传递，不靠会话变量。
3. **点 ▶ 的前提**：块必须有 `runnable`——语言标记被识别、没有冲突旗标（`demo` / `job`+远端 / 非法 `file=` 路径会挡住）。

---

## 一、Python（常驻会话）

同章内变量继续用。最后一行表达式会直接显示值，不用 `print`。

```python
x = 6
y = 7
```

```python
x * y
```

> 预期：第一段无输出（赋值）；第二段显示 `42`。两段共享 `x` `y`——这就是"会话"。

---

## 二、Java JShell（常驻会话）

`java` 块走常驻 JShell，同章 `import` 只写一次。最后一行表达式显示值。

```java
import java.util.stream.IntStream;
```

```java
IntStream.rangeClosed(1, 10).sum()
```

> 预期：第二段显示 `55`。JShell 每次会话从头初始化，第一段的 import 在同章后面一直有效。

---

## 三、Shell（Git Bash，一次性）

默认 `RUNTIME: auto`：本机有 Git Bash 就走 `bash -c`，没有才回退 WSL。

```bash
echo "hello from shell"
pwd
uname -s
```

> 预期：`hello from shell`、当前文档目录、系统名（Git Bash 下是 `MINGW64_NT-...`）。

### 异步作业（`job` 旗标）

长任务用 ` ```bash job `，启动即返回作业号，日志持续外发，可执行窗的终止按钮停掉。

```bash job
for i in 1 2 3 4 5; do echo "tick $i"; sleep 1; done
```

> 预期：立即返回"作业 #N 已启动"，随后每秒吐一行 `tick`。

### 切到 WSL

在文档顶部 front-matter 的 `code-exec:` 下（照上面的前置配置示例）加一段 `shell:`，整篇 `bash` 块就改在 WSL 里跑（Git Bash 的块不受影响，本节只有 shell 族）：

```yaml
shell:
  RUNTIME: wsl
  WSL_DISTRO: Ubuntu-22.04   # 可选：不写用默认发行版
```

切完再点上面那个 bash 块，`uname -s` 会变成 `Linux`。配置含义：

| 键值 | 作用 |
| --- | --- |
| `RUNTIME: auto` | 默认，Git Bash 优先，缺失回退 WSL |
| `RUNTIME: git-bash` | 强制 Git Bash，找不到就报错（不偷偷回退） |
| `RUNTIME: wsl` | 强制 WSL，忽略 Git Bash |
| `WSL_EXE` | 钉死 wsl.exe 路径（可选） |
| `WSL_DISTRO` | `wsl.exe -d <名>` 指定发行版（可选） |
| `LOCAL_SHELL` | 旧的通用旋钮，两种模式都认（可选） |

---

## 四、PowerShell（一次性）

Windows 命令走这里。**注意 5.1 的参数拆词坑**：`-Dxxx=yyy` 这类要加单引号，否则 5.1 会拆成两个参数。

```powershell
$PSVersionTable.PSVersion.ToString()
Get-Location
```

```powershell
# 5.1 下裸写 -Dfile.encoding=UTF-8 会被拆坏；加引号即可
$text = "编码对齐示例"
Write-Output $text
```

> 预期：第一段显示版本号（5.1.x）与当前文档目录；第二段输出中文不乱码。

---

## 五、MySQL（query，出行列）

需要本机 PATH 上有 `mysql` 客户端、且 `code-exec.mysql` 指向的数据库能连。结果以**行列**形式回来，不是纯文本。

```sql
SELECT 1 AS one, 'ok' AS status;
```

> 预期：返回一行两列 `one=1 / status=ok`。连不上时错误卡片会显示客户端报错（主机 / 凭据在 front-matter，密码只放引擎配置层，讲义里写不了）。

---

## 六、Hive（query，走 beeline）

需要 HS2 可连、beeline 可用。若本机没装 beeline，此块点 ▶ 会报"找不到 beeline"——属正常，按你集群的 `code-exec.hive` 配好即可。

```hive
SELECT 1 AS one, 'ok' AS status;
```

> 预期：结构化一行两列。`hive` `hql` `hiveql` `sparksql` 四个标记等价。

---

## 七、File（点 ▶ 写文件，不执行语言）

`file=<路径>` 是**声明**：点它的 ▶ 只把块内容写成文件，不跑代码。路径默认相对**章临时工作目录**；`../` 开头落到**文档所在目录的下级**（课程里 `{course}/doc/` 的 `../code/` 就是课程 `code/`）。

下面演示默认落点（章临时沙箱），不在本仓库里造垃圾目录：

```text file=hello-from-fence.txt
Hello from mdcode2run.
这个文件是点上面那个 ▶ 写出来的，不是被别的块顺带生成的。
```

> 预期：点 ▶ 后写进章临时沙箱（`%TEMP%\md-exec-chapters\<章指纹>\hello-from-fence.txt`，执行窗结果里会回显落点）。想落到文档同级目录写 `file=../code/X`；每次点都覆盖，自己改过要另存副本。这也是**唯一**有 ▶ 的非执行块——`demo` / `invalid` 没有 ▶。

---

## 八、不执行的块（对照）

| 标记 | 效果 |
| --- | --- |
| `demo` | 只展示，`▶` 灰掉，不跑不写 |
| `text`（无 `file=`） | 纯文本，没 ▶（除非配 `LANGS` 当成某族） |
| `expect=<串>` | 断言旗标，跟 `code` 块配合，执行后核对输出 |
| `file=<非法路径>` | 降级为 `invalid`，没有 ▶ |

```sql demo
这是一段示意代码，故意不让它跑：
SELECT * FROM 不存在的表;
```

---

## 九、旗标速查

| 开栏写法 | 角色 | ▶ | 说明 |
| --- | --- | --- | --- |
| ` ```python ` | code | ✓ | 常驻会话 |
| ` ```java ` | code | ✓ | 常驻 JShell |
| ` ```bash ` | code | ✓ | 一次性 shell |
| ` ```bash job ` | code | ✓ | 异步作业，返回作业号 |
| ` ```powershell ` | code | ✓ | 一次性 PowerShell |
| ` ```sql ` | code | ✓ | MySQL 查询，出行列 |
| ` ```hive ` | code | ✓ | Hive 查询，出行列 |
| ` ```text file=xxx ` | file | ✓ | 点 ▶ 写文件 |
| ` ```python demo ` | demo | ✗ | 只展示 |
| ` ```text ` | — | ✗ | 未注册语言，无 ▶ |

冲突组合（如 `demo setup`、`file= expect=`）降级成纯展示块。完整规则见本仓库 `../FENCE.md`；front-matter 配置见 `FRONTMATTER.md`。
