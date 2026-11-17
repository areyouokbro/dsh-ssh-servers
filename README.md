# dsh-ssh-servers

DeepSeek Harness 的 SSH 运维面板。给 agent 用，也给人用。

**[English](#english) · [中文](#中文)**

---

## 中文

### 它解决什么问题

让 AI 通过 SSH 操作服务器，真正的风险不是"连不上"，而是两件事：

1. **它不知道这台机器之前发生过什么** —— 于是重复踩坑、覆盖掉别人刚改好的配置。
2. **它改完之后没有记录** —— 出事了没人说得清是哪条命令、什么时候、谁执行的。

这个插件给每台服务器、每个分组各一本**记忆库**，再加一条**逐条命令的审计流水**，把这两件事补上。

### 功能

**面板**（左侧栏「SSH 服务器」，五视图）

- **概览** — 在线状态、负载/内存/磁盘/进程/端口/容器/失败服务、三条趋势曲线、快捷命令
- **终端** — 真实 PTY。点进去直接打字，`cd`、`tail -f`、`vim` 都能用；切换服务器不会断开，切回来 scrollback 还在
- **文件** — SFTP 列目录、上传、下载、建目录，按服务器记住你看到哪个目录
- **时间线** — 谁、什么时候、在哪台、跑了什么、结果如何
- **记忆** — 组记忆 + 服务器记忆，可加 fact（这台机器是什么、路径约定）和 warning（不能做什么、怎么回滚）

**给 agent 的 16 个工具**

`ssh_brief` 是入口：一次给出组记忆 + 服务器记忆 + 最近操作 + 实时健康。然后 `ssh_exec` 动手，`ssh_memory` 记录，`ssh_journal` 复盘。

其余：`ssh_list_servers`、`ssh_list_groups`、`ssh_list_groups_and_servers`、`ssh_monitor`、`ssh_test`、`ssh_ls`、`ssh_download`、`ssh_upload`、`ssh_mkdir`、`ssh_add_server`、`ssh_delete_server`、`ssh_manager_doctor`。

### 监测默认不执行命令

这是一条硬约束：

| 模式 | 每 20 秒做什么 | 拿到什么 |
| --- | --- | --- |
| `connect`（默认） | 建立 SSH 会话、测握手耗时。**一条命令都不跑** | 在线、延迟 |
| `metrics`（手动开启） | 执行**一条固定的只读命令** | 负载、内存、磁盘、进程… |

`metrics` 那条命令是写死的：`uname`、`cut /proc/loadavg`、`nproc`、`free -m`、`df -P`、`ps -e`、`systemctl --failed`、`docker ps -q`、`ss -ltn`、`who`、`date`。没有写操作。

`test/monitor-smoke.mjs` 用一个假 SSH 服务器断言连接模式下服务器收到的 exec 数为 **0**。

### 审计与风险标记

每条命令完整原文入库，带 actor（agent / 面板）、退出码、耗时、输出摘要，以及命中的风险标签。16 类规则：`rm -rf`、`mkfs`、`dd of=/dev/*`、`shutdown`、`systemctl stop`、`kill -9`、`chmod -R 777`、写 `/etc /var /usr /boot`、`DROP TABLE`、`docker rm/prune`、`git reset --hard` …

风险标记是**提示**，不阻止执行。真正的边界是记忆 + 审计 + 你的判断。

### 安装

在 DSH 里：

```
dsh plugin add dsh-ssh-servers
```

或让 agent 调 `plugin_manager install_bundle`，target 填 `dsh-ssh-servers`。

装完左侧栏会出现「SSH 服务器」。

### 数据在哪

```
$DSH_HOME/plugin-data/ssh-manager/
  store.json                  服务器 + 分组 + 凭据
  journal.jsonl               审计流水
  memory/servers/<id>.json    每台一本记忆
  memory/groups/<id>.json     每组一本记忆
```

### 需要知道的限制

- **凭据本地明文**存在 `store.json`（600 权限）。不回传浏览器，agent 也读不到明文。多用户机器请自行加密磁盘。
- **HTTP 路由只听 127.0.0.1**。别把本机当多租户边界。
- **终端不是完整 VT100**：`htop` 这类全屏重绘会显得粗糙。要干净输出用「单条命令」跑 `top -bn1`。
- **单次传输上限 32 MiB**。更大的文件用 `rsync`。
- **连接受宿主进程生命周期限制**：DSH 退出时连接池关闭。

### 自检

```bash
node test/ui-smoke.mjs       # 面板交互
node test/shell-smoke.mjs    # PTY 通道
node test/monitor-smoke.mjs  # 连接模式不得执行命令
```

---

## English

### The problem

Letting a model operate servers over SSH fails in two specific ways, and neither is "the connection broke":

1. **It does not know what already happened on this box** — so it repeats a mistake or overwrites a fix someone just shipped.
2. **Nothing records what it changed** — so when production breaks, nobody can say which command, when, by whom.

This bundle adds a **memory notebook per server and per group**, plus a **per-command audit trail**.

### What you get

A five-view panel (overview / terminal / files / timeline / memory), a **real PTY** that survives switching servers, SFTP, and 16 agent tools where `ssh_brief` reads memory before acting and `ssh_memory` writes back what was learned.

Monitoring defaults to **connection-only**: it opens the SSH session and times the handshake, and executes nothing on the host. Metrics require opting in to one fixed read-only probe.

Risk tagging covers 16 patterns (`rm -rf`, `mkfs`, `dd of=/dev/*`, `systemctl stop`, `chmod -R 777`, writes under `/etc`, `DROP TABLE`, …). It flags, it does not block.

### Install

```
dsh plugin add dsh-ssh-servers
```

The **SSH servers** entry appears in the left rail.

### Licence

MIT
