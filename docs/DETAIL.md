# SSH 服务器 / SSH servers

面向 **agent 运维** 的服务器管理：分组清单、终端、SFTP，加上两件让 agent 不会把生产搞坏的东西——**操作审计**和**分级记忆**。

面板与 MCP 读写同一份数据，所以你在面板里加的服务器，agent 立刻能用；agent 记下的经验，你打开面板就能看到。

## 三个数据文件

```
$DSH_HOME/plugin-data/ssh-manager/
  store.json                  服务器 + 分组 + 凭据
  journal.jsonl               操作审计（追加式，含完整命令）
  memory/servers/<id>.json    每台服务器一本记忆
  memory/groups/<id>.json     每个分组一本记忆
```

`$DSH_HOME` 缺失时回退 `~/.dsh`。文件按 600 创建；损坏的 store 会被改名保留而不是静默覆盖。

## 操作审计（journal）

**每一次**经插件执行的命令、上传、下载、建目录都会写一行，包含：

| 字段 | 含义 |
| --- | --- |
| `at` | ISO 时间戳 |
| `server` / `group` | 哪台机器、哪个组 |
| `actor` | `agent`（MCP）或 `panel`（面板） |
| `command` | **完整命令原文**，不截断 |
| `exitCode` / `durationMs` | 退出码与耗时 |
| `stdout` / `stderr` | 前 2000 字符摘要 |
| `risk` | 命中的风险规则标签数组 |

风险规则覆盖 `rm -rf`、`mkfs`、`dd of=/dev/*`、`shutdown/reboot`、`systemctl stop`、`kill -9`、清空防火墙、`chmod -R 777`、写入 `/etc /var /usr /boot /opt`、`DROP TABLE`、`docker rm/prune`、`git reset --hard` 等 16 类。

面板的**时间线**页可以按「全部 / 只看风险 / 只看 agent」过滤；agent 用 `ssh_journal` 查同一份数据。文件超过 8 MB 自动保留最近 20000 条。

## 分级记忆（memory）

每台服务器一本，每个分组一本。两种条目：

- **fact** — 稳定知识：这台机器跑什么、端口、路径约定、发布方式
- **warning** — 不能做的事：承载业务的路径、上次事故的原因、回滚步骤

还有一行 `summary` 做整体描述。记忆会在 `ssh_brief` 里完整呈现给 agent，面板「记忆」页可以直接编辑。

**工作闭环**：`ssh_brief` 读 → 动手 → 有变更就 `ssh_memory add` 写回。命中风险规则时，`ssh_exec` 的返回会追加一句提醒，让 agent 知道该记录了。

## Agent 侧工具（`mcp__ssh__*`，共 15 个）

| 工具 | 用途 |
| --- | --- |
| `ssh_brief` | **运维前必读**：组记忆 + 服务器记忆 + 最近 10 条操作 + 实时健康 |
| `ssh_list_servers` / `ssh_list_groups` / `ssh_list_groups_and_servers` | 清单 |
| `ssh_exec` | 执行命令，返回 stdout/stderr/退出码；风险命令会被标记 |
| `ssh_monitor` | 全量或按组批量健康：负载、内存、磁盘、运行时长、延迟 |
| `ssh_test` | 单台连通性与系统信息 |
| `ssh_ls` / `ssh_download` / `ssh_upload` / `ssh_mkdir` | SFTP |
| `ssh_journal` | 查审计：谁、什么时候、在哪台、跑了什么、结果 |
| `ssh_memory` | 读写服务器/分组记忆（read / add / summary / clear） |
| `ssh_add_server` / `ssh_delete_server` | 维护清单 |

另有 `ssh_manager_doctor`：在对话里直接回答清单在哪、几台机器、池里几条连接。

## 面板

左侧栏「SSH 服务器」打开整页面板（同时挂在 设置 → SSH 服务器、插件详情页）。五个视图：

- **概览** — 状态条（在线/注意/异常、延迟、核数、更新时间、`⚡ 测连接`）、九个指标（负载/内存/交换/磁盘/进程/端口/容器/登录/运行时长）、高占用分区、**三条趋势曲线**、快捷命令、最近操作
- **终端** — 两种模式：**交互式**（真 PTY，见下）与**单条命令**（一次性执行并留痕）
- **文件** — SFTP 列目录、上传、下载、建目录、上级
- **时间线** — 审计流，风险行左侧红条
- **记忆** — 组记忆与服务器记忆双卡，可增删事实/警告、改摘要

### 自动监测

不是点一次看一次：Host 每 **20 秒**探测全部服务器（并发 4，上一轮没跑完就跳过），结果缓存在内存里；面板每 **20 秒**读一次缓存，页面切到后台时暂停。左栏的状态点、内存百分比、顶部在线数都来自这里。

**两种模式，默认不执行任何命令：**

| 模式 | 每 20 秒做什么 | 拿到什么 |
| --- | --- | --- |
| `connect`（默认） | 建立 SSH 会话、测握手耗时。**一条命令都不跑，连 shell 都不开** | 在线/离线、延迟、状态点 |
| `metrics`（手动开启） | 执行**一条固定的只读命令** | 负载、内存、交换、磁盘、进程、失败服务、容器、端口、登录数 |

`metrics` 那条命令是写死的组合：`uname`、`cut /proc/loadavg`、`nproc`、`free -m`、`df -P`、`ps -e`、`systemctl --failed`、`docker ps -q`、`ss -ltn`、`who`、`date`。没有 `rm`/`cp`/`mv`/`systemctl start|stop`/`chmod` 这类写操作，不改任何文件或服务。

面板概览顶部有模式标签和切换按钮；`test/monitor-smoke.mjs` 用一个假 SSH 服务器断言 `connect` 模式下服务器收到的 exec 数为 **0**。

agent 侧同样遵守：`ssh_monitor` 和 `ssh_brief` 的健康行都按这个设置执行，连接模式下的输出会明说「no command was executed」。

状态点阈值：磁盘 ≥92%、内存 ≥95%、有失败 systemd 单元 → 红；磁盘 ≥80%、内存 ≥85%、负载 ≥100% → 黄。连接模式下只区分在线/离线。

### 交互式终端

点「终端」→「交互式」会自动开一个真实 PTY（`xterm-256color`）：

- 点终端区域后直接打字，Enter/Backspace/Tab/方向键/Home/End/Delete/Ctrl+C 都转发给远端
- 输出通过 SSE 流式推送；末尾有一个闪烁光标块
- `bash`、`cd`、`ls`、`tail -f`、`vim` 基本可用

**会话是持久的**：切到另一台服务器、去「文件」页逛一圈、再切回来，还是同一个 shell，scrollback 都在。会话按服务器存在面板里，只有点「断开」、远端 `exit`、或插件卸载才会关闭。

「失败服务」标签可以直接点：健康扫描会带上服务名（`gen-5` 起），带不上就点一下，它会执行 `systemctl --failed` 并把结果贴在下面。

**它不是完整 VT100 模拟器**：只处理 `\n \r \b`、擦行、清屏和光标列定位，其它转义序列丢弃。所以 `htop`、`vim` 的全屏重绘会显得粗糙，长时间运行的 `top` 会堆叠残影。要干净的全屏程序，用「单条命令」跑 `top -bn1` 这类一次性形式。

终端会话在断开、远端退出、30 分钟无人查看、或插件卸载时结束。

## 改 UI 之后的自检

```bash
node test/ui-smoke.mjs       # 面板交互（点击→输入→POST→渲染→切换服务器）
node test/shell-smoke.mjs    # PTY 通道（自建假 SSH 服务器，不碰真机）
node test/monitor-smoke.mjs  # 监测保证：connect 模式下 exec 数必须为 0
```

`ui-smoke` 用一个迷你渲染器真实执行「点 + 分组 → 输入框出现 → 输名字回车 → POST /group 发出 → 分组行显示」，再验证服务器表单、概览指标、趋势曲线、终端工具栏。它存在的理由很具体：曾经空库时整个左栏被空状态文案替换，按钮点了没有任何可见变化。

`shell-smoke` 在本进程里起一个 ssh2 服务端，验证 PTY 请求、回放缓冲、流式输出、输入转发、resize 与关闭清理。

**改 client.js 之后先跑它们，再刷新页面。**

## 需要知道的限制

- **凭据是本地明文**：存在 `store.json`，不回传浏览器（面板只拿到 `hasPassword` 这类布尔），agent 通过 MCP 也读不到。多用户机器请自行加密磁盘。
- **面板走本机 HTTP 路由**（`/dsh-ssh-manager/*`，只听 127.0.0.1）。写操作在能观测浏览器会话时要求签名 cookie；若该 composition 的 `browserAuth` 不可观测则放行。别把本机当多租户边界。
- **单条命令模式不分配 TTY**：`vim`、`top` 这类需要终端的程序请用「交互式」。
- **交互式终端不是完整 VT100**：全屏重绘类程序（`htop`、`vim`）会显得粗糙。
- **文件页的路径按服务器记忆**，切走再回来会回到你刚才看的目录。
- **MCP 行用绝对路径**指向 `mcp-server.mjs`；移动插件目录后要同步改 `cordis.patch.yml` 里那一行，否则 `mcp__ssh__*` 不会出现。

## 排障

**改完代码为什么看不到变化？** 两种情况不一样：

- 改 `client.js` → 只需刷新页面（Ctrl+R）。客户端模块由 client-modules 按文件快照重新发布。
- 改 `index.js` / `lib/*` → **必须重启 DSH 桌面端**。本地目录安装的包不会被热替换：`plugin_manager` 的开关只重启 fiber，Node 仍复用已加载的模块代，于是磁盘上是新代码、跑着的还是旧的。判断方法：新加的路由 404、或 `/state` 的返回里缺了你刚加的字段。

MCP 侧不受影响 —— 它每次都是新 spawn 的进程，重启那一行就加载新代码。

1. 左侧栏没有条目 → 看**设置 → 插件**里 `@local/dsh-ssh-manager` 是否 active；再按 F12 找 `[dsh-ssh-manager]` 前缀的报错。
2. 对话里没有 `mcp__ssh__*` → 调 `ssh_manager_doctor`，它报告桥接与清单状态。
3. 「测连接」超时 → 网络/安全组/端口；`All configured authentication methods failed` → 凭据。
4. 时间线为空但确实执行过 → 确认是在同一个 `$DSH_HOME` 下（面板与 MCP 必须共享环境变量）。
