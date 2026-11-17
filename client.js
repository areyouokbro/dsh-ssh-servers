/**
 * Client half of dsh-ssh-manager.
 *
 * Four seats:
 *   sidebar.panellist + main  → the left-rail row and the full page it opens
 *   settings.section          → a page inside Settings
 *   plugins.bundle.config     → this bundle's own page in Plugins
 *
 * The page itself: a server tree on the left, and on the right five views —
 * overview, console, files, timeline, memory. Timeline and memory are the
 * point: an agent operating these machines has to see what was already done
 * here and what must not be done again.
 */
window.__ModuleLoader__.load({
  id: 'dsh-ssh-servers',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useMemo, useRef } = React;

    const PACKAGE_ID = 'dsh-ssh-servers';
    const SETTINGS_SLOT = 'settings.section';
    const SETTINGS_ICON_SLOT = 'settings.section.icon';
    const BUNDLE_SLOT = 'plugins.bundle.config';
    const SIDEBAR_SLOT = 'sidebar.panellist';
    const MAIN_SLOT = 'main';
    const PANEL_ID = 'ssh-manager-panel';
    const PANEL_ORDER = 30;
    const ENTRY_ID = 'ssh-manager-settings';
    const ENTRY_ORDER = 63;

    const API = {
      state: 'dsh-ssh-manager/state',
      group: 'dsh-ssh-manager/group',
      server: 'dsh-ssh-manager/server',
      exec: 'dsh-ssh-manager/exec',
      probe: 'dsh-ssh-manager/probe',
      monitor: 'dsh-ssh-manager/monitor',
      settings: 'dsh-ssh-manager/settings',
      ls: 'dsh-ssh-manager/ls',
      upload: 'dsh-ssh-manager/upload',
      download: 'dsh-ssh-manager/download',
      mkdir: 'dsh-ssh-manager/mkdir',
      journal: 'dsh-ssh-manager/journal',
      memory: 'dsh-ssh-manager/memory',
      shellOpen: 'dsh-ssh-manager/shell/open',
      shellStream: 'dsh-ssh-manager/shell/stream',
      shellInput: 'dsh-ssh-manager/shell/input',
      shellResize: 'dsh-ssh-manager/shell/resize',
      shellClose: 'dsh-ssh-manager/shell/close',
      hello: 'dsh-ssh-manager/client-hello',
    };

    /* ---------------------------------------------------------------- *
     * copy
     * ---------------------------------------------------------------- */

    const COPY = {
      zh: {
        title: 'SSH 服务器',
        tagline: '分组管理 · 终端 · 文件 · 操作审计 · 服务器记忆',
        addServer: '服务器',
        addGroup: '分组',
        refresh: '刷新',
        search: '搜索名称、主机、备注…',
        ungrouped: '未分组',
        noServers: '还没有服务器。点右上角「服务器」新增一台。',
        pick: '从左边选一台服务器，或先新增一台。',
        tabs: { overview: '概览', console: '终端', files: '文件', timeline: '时间线', memory: '记忆' },
        detail: '详情',
        edit: '编辑',
        remove: '删除',
        save: '保存',
        cancel: '取消',
        test: '测连接',
        host: '主机',
        port: '端口',
        user: '用户',
        group: '分组',
        authType: '认证',
        authKey: '私钥',
        authPassword: '密码',
        password: '密码',
        keep: '留空 = 保持原值',
        privateKey: '私钥内容',
        keyPath: '本机私钥路径',
        passphrase: '私钥口令',
        jump: '跳板机',
        none: '（无）',
        direct: '直连',
        name: '名称',
        note: '备注',
        command: '命令',
        run: '执行',
        running: '执行中',
        clear: '清空',
        path: '远程路径',
        list: '列目录',
        upload: '上传',
        download: '下载',
        mkdir: '建目录',
        up: '上级',
        metrics: '实时状态',
        noMetrics: '点「测连接」拉取状态',
        load: '负载',
        mem: '内存',
        disk: '磁盘',
        uptime: '运行',
        latency: '延迟',
        platform: '系统',
        quick: '快捷命令',
        recent: '最近操作',
        noJournal: '还没有操作记录',
        journalHint: 'agent 与面板的每一次命令、上传、下载都会记在这里',
        memoryGroup: '组记忆',
        memoryServer: '服务器记忆',
        memoryEmpty: '还没有记录',
        memorySummary: '摘要',
        addFact: '加事实',
        addWarning: '加警告',
        saveSummary: '保存摘要',
        factPlaceholder: '这台机器/这个组是什么、跑什么、路径约定…',
        warningPlaceholder: '不能做什么 / 上次事故的原因 / 回滚方式…',
        facts: '事实',
        warnings: '警告',
        filterAll: '全部',
        filterRisk: '只看风险',
        filterAgent: '只看 agent',
        byAgent: 'agent',
        byPanel: '面板',
        ok: '成功',
        failed: '失败',
        riskTag: '风险',
        deleteServerConfirm: '删除这台服务器？只删本地记录。',
        deleteGroupConfirm: '删除这个分组？组内服务器会变成未分组。',
        groupNamePrompt: '分组名称',
        renamePrompt: '新的分组名称',
        dirNamePrompt: '新建目录名',
        needName: '名称必填',
        needHost: '主机必填',
        credHint: '凭据保存在本机 store.json，不回传浏览器；agent 通过 MCP 也读不到明文。',
        storeAt: '数据目录',
        docs: '文档',
        confirmAgain: '确认删除?',
        groupPlaceholder: '分组名称，回车保存',
        statusIdle: '等待探测',
        statusOk: '在线',
        statusWarn: '注意',
        statusCrit: '异常',
        updated: '更新于',
        never: '尚未探测',
        liveHint: '每 20 秒自动刷新',
        cores: '核',
        swap: '交换',
        procs: '进程',
        failedUnits: '失败服务',
        containers: '容器',
        ports: '端口',
        users: '登录',
        kernel: '内核',
        trend: '趋势',
        hotDisks: '高占用分区',
        onlineSummary: '在线',
        term: '终端',
        termInteractive: '交互式',
        termOneShot: '单条命令',
        termConnect: '连接',
        termReconnect: '重连',
        termDisconnect: '断开',
        termConnecting: '正在连接…',
        termClosed: '连接已关闭',
        termHint: '点击终端区域后可直接打字。Ctrl+C 中断，输入 exit 退出。',
        termNeedsFocus: '点一下这里开始输入',
        probeNow: '测连接',
        modeConnect: '仅连接监测',
        modeMetrics: '只读指标',
        modeConnectHint: '每 20 秒只建立 SSH 连接、测握手延迟，不执行任何命令',
        modeMetricsHint: '每 20 秒执行一条固定的只读命令，采集负载/内存/磁盘',
        switchToConnect: '改为只连接',
        switchToMetrics: '开启指标采集',
        connectOnlyEmpty: '仅连接模式：不执行命令，所以没有 CPU / 内存 / 磁盘数据。需要时点「开启指标采集」——那只是一条固定的只读命令，不改动任何东西。',
        agentTip: '让 agent 先读记忆：在对话里说「先 ssh_brief 看 web-01 的记忆再动手」',
        disabled: '未启用',
        logCommand: '命令',
        exit: '退出码',
        took: '耗时',
      },
      en: {
        title: 'SSH servers',
        tagline: 'Groups · console · files · audit trail · server memory',
        addServer: 'Server',
        addGroup: 'Group',
        refresh: 'Refresh',
        search: 'Filter by name, host, note…',
        ungrouped: 'Ungrouped',
        noServers: 'No server yet. Use “Server” in the top right.',
        pick: 'Pick a server on the left, or add one first.',
        tabs: { overview: 'Overview', console: 'Console', files: 'Files', timeline: 'Timeline', memory: 'Memory' },
        detail: 'Details',
        edit: 'Edit',
        remove: 'Delete',
        save: 'Save',
        cancel: 'Cancel',
        test: 'Test',
        host: 'Host',
        port: 'Port',
        user: 'User',
        group: 'Group',
        authType: 'Auth',
        authKey: 'Key',
        authPassword: 'Password',
        password: 'Password',
        keep: 'empty = keep saved',
        privateKey: 'Private key',
        keyPath: 'Local key path',
        passphrase: 'Key passphrase',
        jump: 'Jump host',
        none: '(none)',
        direct: 'direct',
        name: 'Name',
        note: 'Note',
        command: 'Command',
        run: 'Run',
        running: 'Running',
        clear: 'Clear',
        path: 'Remote path',
        list: 'List',
        upload: 'Upload',
        download: 'Download',
        mkdir: 'New dir',
        up: 'Up',
        metrics: 'Live status',
        noMetrics: 'Run “Test” to fetch status',
        load: 'Load',
        mem: 'Memory',
        disk: 'Disk',
        uptime: 'Uptime',
        latency: 'Latency',
        platform: 'Platform',
        quick: 'Quick commands',
        recent: 'Recent operations',
        noJournal: 'Nothing recorded yet',
        journalHint: 'Every command, upload and download — by agent or by panel — lands here',
        memoryGroup: 'Group memory',
        memoryServer: 'Server memory',
        memoryEmpty: 'Nothing recorded yet',
        memorySummary: 'Summary',
        addFact: 'Add fact',
        addWarning: 'Add warning',
        saveSummary: 'Save summary',
        factPlaceholder: 'What this machine/group is, what runs here, path conventions…',
        warningPlaceholder: 'What must not be done / why it broke last time / how to roll back…',
        facts: 'Facts',
        warnings: 'Warnings',
        filterAll: 'All',
        filterRisk: 'Risky',
        filterAgent: 'Agent only',
        byAgent: 'agent',
        byPanel: 'panel',
        ok: 'ok',
        failed: 'failed',
        riskTag: 'risk',
        deleteServerConfirm: 'Delete this server? Only the local record is removed.',
        deleteGroupConfirm: 'Delete this group? Its servers become ungrouped.',
        groupNamePrompt: 'Group name',
        renamePrompt: 'New group name',
        dirNamePrompt: 'New folder name',
        needName: 'Name is required',
        needHost: 'Host is required',
        credHint: 'Credentials live in the local store.json. The browser never gets them back; nor does the agent over MCP.',
        storeAt: 'Data directory',
        docs: 'Docs',
        confirmAgain: 'Confirm?',
        groupPlaceholder: 'Group name, Enter to save',
        statusIdle: 'waiting',
        statusOk: 'online',
        statusWarn: 'warning',
        statusCrit: 'critical',
        updated: 'updated',
        never: 'not probed yet',
        liveHint: 'refreshes every 20s',
        cores: 'cores',
        swap: 'swap',
        procs: 'processes',
        failedUnits: 'failed units',
        containers: 'containers',
        ports: 'listening',
        users: 'logged in',
        kernel: 'kernel',
        trend: 'Trend',
        hotDisks: 'Full filesystems',
        onlineSummary: 'online',
        term: 'Terminal',
        termInteractive: 'Interactive',
        termOneShot: 'One-shot',
        termConnect: 'Connect',
        termReconnect: 'Reconnect',
        termDisconnect: 'Disconnect',
        termConnecting: 'connecting…',
        termClosed: 'connection closed',
        termHint: 'Click the terminal, then type. Ctrl+C interrupts, `exit` leaves.',
        termNeedsFocus: 'click here to type',
        probeNow: 'Test',
        modeConnect: 'connection only',
        modeMetrics: 'read-only metrics',
        modeConnectHint: 'every 20s: opens the SSH session and times the handshake. No command is executed.',
        modeMetricsHint: 'every 20s: runs one fixed read-only command for load / memory / disk.',
        switchToConnect: 'connection only',
        switchToMetrics: 'enable metrics',
        connectOnlyEmpty: 'Connection-only mode: no command runs, so there is no CPU / memory / disk data. Press “enable metrics” when you want it — that is one fixed read-only command and changes nothing.',
        agentTip: 'Make the agent read memory first: “ssh_brief web-01 before touching it”.',
        disabled: 'disabled',
        logCommand: 'command',
        exit: 'exit',
        took: 'took',
      },
    };

    const t = COPY[(function () {
      try {
        return String(navigator.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en';
      } catch {
        return 'en';
      }
    })()];

    /* ---------------------------------------------------------------- *
     * transport
     * ---------------------------------------------------------------- */

    function apiUrl(path) {
      const relative = String(path).replace(/^\/+/, '');
      try {
        if (typeof document === 'undefined') return `/${relative}`;
        return new URL(relative, document.baseURI).pathname;
      } catch {
        return `/${relative}`;
      }
    }

    async function getJson(path) {
      const response = await fetch(apiUrl(path), { cache: 'no-store', headers: { accept: 'application/json' } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `${response.status} ${response.statusText}`);
      return body;
    }

    async function postJson(path, payload) {
      const response = await fetch(apiUrl(path), {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `${response.status} ${response.statusText}`);
      return body;
    }

    /** One-shot evidence that this module ran in the browser. */
    let reportedApply = false;
    function report(kind) {
      try {
        fetch(apiUrl(API.hello), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind, version: '2.0.0' }),
          keepalive: true,
        }).catch(() => {});
      } catch {
        /* diagnostics are optional */
      }
    }

    /* ---------------------------------------------------------------- *
     * styles
     * ---------------------------------------------------------------- */

    const CSS = `
.smg {
  --smg-line: color-mix(in srgb, currentColor 12%, transparent);
  --smg-line-soft: color-mix(in srgb, currentColor 7%, transparent);
  --smg-line-strong: color-mix(in srgb, currentColor 22%, transparent);
  --smg-fill: color-mix(in srgb, currentColor 4%, transparent);
  --smg-fill-hover: color-mix(in srgb, currentColor 9%, transparent);
  --smg-ok: #2f9e5f; --smg-warn: #d9a12f; --smg-crit: #e5484d; --smg-accent: #3b82f6;
  display: grid; grid-template-rows: auto 1fr; height: 100%; min-height: 0;
  font-size: 13px; color: inherit; line-height: 1.5;
}
.smg * { box-sizing: border-box; }

.smg-head {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 18px; border-bottom: 1px solid var(--smg-line);
  background: color-mix(in srgb, currentColor 2%, transparent);
}
.smg-brand { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.smg-title { margin: 0; font-size: 14px; font-weight: 650; letter-spacing: .01em; }
.smg-tagline { font-size: 11px; opacity: .5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.smg-head-gap { flex: 1; }
.smg-search {
  font: inherit; font-size: 12px; color: inherit; width: 200px;
  background: var(--smg-fill); border: 1px solid var(--smg-line);
  border-radius: 8px; padding: 6px 10px; outline: none;
}
.smg-search:focus { border-color: color-mix(in srgb, var(--smg-accent) 55%, transparent); }

.smg-btn {
  appearance: none; border: 1px solid var(--smg-line-strong); background: var(--smg-fill);
  color: inherit; border-radius: 8px; padding: 6px 12px; font: inherit; font-size: 12px;
  cursor: pointer; white-space: nowrap; display: inline-flex; align-items: center; gap: 6px;
  transition: background .12s ease, border-color .12s ease;
}
.smg-btn:hover:not(:disabled) { background: var(--smg-fill-hover); }
.smg-btn:disabled { opacity: .45; cursor: default; }
.smg-btn--primary { background: var(--smg-accent); border-color: transparent; color: #fff; }
.smg-btn--primary:hover:not(:disabled) { background: #2f6feb; }
.smg-btn--danger { color: var(--smg-crit); border-color: color-mix(in srgb, var(--smg-crit) 40%, transparent); }
.smg-btn--ghost { border-color: transparent; background: transparent; opacity: .7; padding: 3px 7px; }
.smg-btn--ghost:hover:not(:disabled) { opacity: 1; background: var(--smg-fill-hover); }
.smg-btn--sm { padding: 4px 9px; font-size: 11.5px; }

.smg-body { display: grid; grid-template-columns: 258px minmax(0, 1fr); min-height: 0; }
.smg-rail { border-right: 1px solid var(--smg-line); overflow: auto; padding: 10px 8px; }
.smg-main { overflow: auto; padding: 0; min-width: 0; display: flex; flex-direction: column; }

.smg-railGroup { margin-bottom: 4px; }
.smg-railNew { display: flex; gap: 6px; padding: 6px 4px 8px; }
.smg-railHead {
  display: flex; align-items: center; gap: 6px; padding: 6px 6px 4px;
  font-size: 11px; letter-spacing: .03em; text-transform: uppercase; opacity: .55;
}
.smg-railHead .smg-grow { flex: 1; }
.smg-count {
  font-size: 10px; padding: 0 5px; border-radius: 999px;
  background: var(--smg-fill-hover); opacity: .9; font-variant-numeric: tabular-nums;
}
.smg-row {
  display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
  border: 1px solid transparent; background: transparent; color: inherit; font: inherit;
  border-radius: 8px; padding: 7px 9px; cursor: pointer;
}
.smg-row:hover { background: var(--smg-fill-hover); }
.smg-row--active {
  background: color-mix(in srgb, var(--smg-accent) 15%, transparent);
  border-color: color-mix(in srgb, var(--smg-accent) 40%, transparent);
}
.smg-rowMain { min-width: 0; flex: 1; }
.smg-rowName { font-size: 12.5px; font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.smg-rowSub { font-size: 11px; opacity: .5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.smg-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.smg-dot--ok { background: var(--smg-ok); }
.smg-dot--warn { background: var(--smg-warn); }
.smg-dot--crit { background: var(--smg-crit); }
.smg-dot--idle { background: color-mix(in srgb, currentColor 30%, transparent); }

.smg-tabs {
  display: flex; align-items: center; gap: 2px; padding: 8px 14px 0;
  border-bottom: 1px solid var(--smg-line); position: sticky; top: 0; z-index: 3;
  background: color-mix(in srgb, currentColor 1%, transparent); backdrop-filter: blur(6px);
  flex-wrap: wrap;
}
.smg-tab {
  border: none; background: transparent; color: inherit; font: inherit; font-size: 12.5px;
  cursor: pointer; padding: 7px 11px; border-radius: 8px 8px 0 0; opacity: .6;
  border-bottom: 2px solid transparent; margin-bottom: -1px;
}
.smg-tab:hover { opacity: .9; background: var(--smg-fill); }
.smg-tab--active { opacity: 1; font-weight: 600; border-bottom-color: var(--smg-accent); }
.smg-tabsGap { flex: 1; }
.smg-pane { padding: 16px 18px; display: flex; flex-direction: column; gap: 14px; }

.smg-card {
  border: 1px solid var(--smg-line); border-radius: 10px; padding: 14px 16px;
  background: color-mix(in srgb, currentColor 2.5%, transparent);
}
.smg-cardHead { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.smg-cardTitle { font-size: 12px; font-weight: 600; letter-spacing: .02em; text-transform: uppercase; opacity: .6; }
.smg-cardGap { flex: 1; }

.smg-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); gap: 12px; }
.smg-metric { display: flex; flex-direction: column; gap: 5px; }
.smg-metricLabel { font-size: 11px; opacity: .55; }
.smg-metricValue { font-size: 17px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
.smg-metricValue small { font-size: 11px; font-weight: 400; opacity: .55; }
.smg-bar { height: 5px; border-radius: 3px; background: color-mix(in srgb, currentColor 10%, transparent); overflow: hidden; }
.smg-bar > i { display: block; height: 100%; border-radius: 3px; background: var(--smg-accent); }
.smg-bar--warn > i { background: var(--smg-warn); }
.smg-bar--crit > i { background: var(--smg-crit); }

.smg-kv { display: grid; grid-template-columns: 88px 1fr; gap: 6px 12px; font-size: 12px; }
.smg-kv dt { opacity: .5; }
.smg-kv dd { margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.smg-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; }

.smg-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.smg-chip {
  border: 1px solid var(--smg-line); background: var(--smg-fill); color: inherit;
  font: inherit; font-size: 11.5px; border-radius: 999px; padding: 4px 10px; cursor: pointer;
}
.smg-chip:hover { background: var(--smg-fill-hover); }

.smg-input, .smg-select, .smg-area {
  font: inherit; font-size: 12.5px; color: inherit; background: var(--smg-fill);
  border: 1px solid var(--smg-line); border-radius: 8px; padding: 7px 9px; width: 100%; outline: none;
}
.smg-input:focus, .smg-select:focus, .smg-area:focus {
  border-color: color-mix(in srgb, var(--smg-accent) 55%, transparent);
}
.smg-area { resize: vertical; min-height: 62px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; }
.smg-formGrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
.smg-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.smg-field--wide { grid-column: 1 / -1; }
.smg-label { font-size: 11px; opacity: .55; }

.smg-rowFlex { display: flex; gap: 8px; align-items: center; }
.smg-rowFlex > .smg-input { flex: 1; }
.smg-formFoot { display: flex; gap: 8px; align-items: center; margin-top: 12px; flex-wrap: wrap; }

.smg-out {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px;
  line-height: 1.6; white-space: pre-wrap; word-break: break-word; margin: 0;
  background: var(--smg-fill); border: 1px solid var(--smg-line-soft);
  border-radius: 8px; padding: 10px 12px; max-height: 360px; overflow: auto;
}
.smg-out--term { background: #0d1117; color: #c9d1d9; border-color: #21262d; }
.smg-out--term .smg-prompt { color: #6ea8fe; }
.smg-out--term .smg-exit { color: #7ee787; }
.smg-out--term .smg-exit--bad { color: #ff7b72; }
.smg-out--term .smg-stderr { color: #ffa198; }

.smg-tl { display: flex; flex-direction: column; }
.smg-tlRow {
  display: grid; grid-template-columns: 58px 54px minmax(0, 1fr) auto; gap: 10px;
  padding: 7px 8px; border-bottom: 1px solid var(--smg-line-soft);
  font-size: 12px; align-items: baseline; border-left: 2px solid transparent;
}
.smg-tlRow:last-child { border-bottom: none; }
.smg-tlRow--risk { border-left-color: var(--smg-crit); background: color-mix(in srgb, var(--smg-crit) 7%, transparent); }
.smg-tlTime { opacity: .45; font-variant-numeric: tabular-nums; font-size: 11px; }
.smg-tag {
  font-size: 10px; padding: 1px 6px; border-radius: 999px;
  border: 1px solid var(--smg-line-strong); opacity: .8; justify-self: start; white-space: nowrap;
}
.smg-tag--agent { border-color: color-mix(in srgb, var(--smg-accent) 50%, transparent); color: var(--smg-accent); opacity: 1; }
.smg-tag--risk { border-color: color-mix(in srgb, var(--smg-crit) 55%, transparent); color: var(--smg-crit); opacity: 1; }
.smg-tag--ok { border-color: color-mix(in srgb, var(--smg-ok) 45%, transparent); color: var(--smg-ok); opacity: 1; }
.smg-tag--fail { border-color: color-mix(in srgb, var(--smg-crit) 45%, transparent); color: var(--smg-crit); opacity: 1; }
.smg-tlWhat { min-width: 0; overflow-wrap: anywhere; }

.smg-list { border: 1px solid var(--smg-line-soft); border-radius: 8px; overflow: hidden; }
.smg-fileRow {
  display: flex; align-items: center; gap: 10px; padding: 6px 10px; font-size: 12px;
  border-bottom: 1px solid var(--smg-line-soft);
}
.smg-fileRow:last-child { border-bottom: none; }
.smg-fileRow:hover { background: var(--smg-fill); }
.smg-fileName { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.smg-fileName:hover { text-decoration: underline; }
.smg-fileMeta { opacity: .45; font-size: 11px; font-variant-numeric: tabular-nums; }

.smg-empty { padding: 26px 16px; text-align: center; opacity: .45; font-size: 12px; line-height: 1.7; }
.smg-error { color: var(--smg-crit); font-size: 12px; margin: 0; }
.smg-okText { color: var(--smg-ok); font-size: 12px; margin: 0; }
.smg-hint { font-size: 11px; opacity: .45; margin: 0; line-height: 1.6; }
.smg-warnBox {
  font-size: 12px; border-radius: 8px; padding: 9px 11px;
  background: color-mix(in srgb, var(--smg-warn) 13%, transparent);
  border: 1px solid color-mix(in srgb, var(--smg-warn) 36%, transparent);
}
.smg-memList { display: flex; flex-direction: column; gap: 6px; }
.smg-memItem {
  display: flex; gap: 8px; align-items: flex-start; font-size: 12px;
  padding: 6px 8px; border-radius: 7px; background: var(--smg-fill);
}
.smg-memItem--warn { background: color-mix(in srgb, var(--smg-crit) 9%, transparent); }
.smg-memText { flex: 1; min-width: 0; overflow-wrap: anywhere; }

.smg-strip {
  display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
  padding: 10px 14px; border: 1px solid var(--smg-line); border-radius: 10px;
  background: var(--smg-fill); font-size: 12px;
}
.smg-stripStat { display: flex; align-items: baseline; gap: 6px; }
.smg-stripNum { font-size: 16px; font-weight: 650; font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
.smg-stripGap { flex: 1; }
.smg-live { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; opacity: .6; }
.smg-liveDot {
  width: 6px; height: 6px; border-radius: 50%; background: var(--smg-ok);
  animation: smg-pulse 2s ease-in-out infinite;
}
@keyframes smg-pulse { 0%, 100% { opacity: .35 } 50% { opacity: 1 } }

.smg-sparkWrap { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
.smg-sparkCard { border: 1px solid var(--smg-line-soft); border-radius: 8px; padding: 8px 10px 6px; }
.smg-sparkHead { display: flex; justify-content: space-between; align-items: baseline; font-size: 11px; opacity: .6; margin-bottom: 2px; }
.smg-spark { display: block; width: 100%; height: 30px; overflow: visible; }
.smg-sparkLine { fill: none; stroke-width: 1.5; stroke-linejoin: round; stroke-linecap: round; }
.smg-sparkArea { opacity: .12; }

.smg-metrics { grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); }
.smg-tag--warn { border-color: color-mix(in srgb, var(--smg-warn) 50%, transparent); color: var(--smg-warn); opacity: 1; }
.smg-tag--crit { border-color: color-mix(in srgb, var(--smg-crit) 55%, transparent); color: var(--smg-crit); opacity: 1; }
.smg-rowDot { margin-left: auto; font-size: 10px; opacity: .5; font-variant-numeric: tabular-nums; white-space: nowrap; }

.smg-term {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px; line-height: 1.5;
  background: #0b0f14; color: #cdd6df;
  border: 1px solid #1d2630; border-radius: 8px;
  padding: 10px 12px; height: 460px; overflow: auto;
  white-space: pre; outline: none; cursor: text; tab-size: 4;
}
.smg-term:focus { border-color: color-mix(in srgb, var(--smg-accent) 65%, transparent); }
.smg-termHint { opacity: .35; }
.smg-term > div { min-height: 1.5em; }
.smg-cursor {
  background: #cdd6df; color: #0b0f14;
  animation: smg-blink 1.1s step-end infinite;
}
@keyframes smg-blink { 0%, 100% { opacity: 1 } 50% { opacity: .15 } }
`;

    let styleNode = null;
    function installStyles() {
      if (typeof document === 'undefined' || styleNode !== null) return;
      try {
        styleNode = document.createElement('style');
        styleNode.setAttribute('data-dsh-ssh-manager', '');
        styleNode.textContent = CSS;
        document.head.appendChild(styleNode);
      } catch {
        styleNode = null;
      }
    }
    function removeStyles() {
      try {
        if (styleNode !== null && styleNode.parentNode !== null) styleNode.parentNode.removeChild(styleNode);
      } catch {
        /* teardown */
      }
      styleNode = null;
    }

    /* ---------------------------------------------------------------- *
     * small components
     * ---------------------------------------------------------------- */

    function Btn(props) {
      const variants = (props.variant === undefined ? '' : ` smg-btn--${props.variant}`) + (props.small === true ? ' smg-btn--sm' : '');
      return h(
        'button',
        {
          type: 'button',
          className: `smg-btn${variants}${props.className === undefined ? '' : ` ${props.className}`}`,
          onClick: props.onClick,
          disabled: props.disabled === true,
          title: props.title,
        },
        props.children,
      );
    }

    function Field(props) {
      return h(
        'label',
        { className: `smg-field${props.wide === true ? ' smg-field--wide' : ''}` },
        h('span', { className: 'smg-label' }, props.label),
        props.children,
      );
    }

    /**
     * Two-step delete. `window.confirm` does not exist in the Electron shell,
     * so a destructive action arms itself on the first click instead.
     */
    function ConfirmButton(props) {
      const [armed, setArmed] = useState(false);
      useEffect(() => {
        if (!armed) return undefined;
        const timer = setTimeout(() => setArmed(false), 4000);
        return () => clearTimeout(timer);
      }, [armed]);
      return h(
        'button',
        {
          type: 'button',
          className: `smg-btn smg-btn--sm${armed ? ' smg-btn--danger' : ''}`,
          disabled: props.disabled === true,
          title: props.title,
          onClick: () => {
            if (!armed) {
              setArmed(true);
              return;
            }
            setArmed(false);
            props.onConfirm();
          },
        },
        armed ? (props.confirmLabel ?? t.confirmAgain) : props.children,
      );
    }

    /**
     * Inline single-field editor. Replaces `window.prompt`, which the Electron
     * shell does not implement — that is why a prompt-based button looked dead.
     */
    function InlineInput(props) {
      const [value, setValue] = useState(props.initial ?? '');
      const submit = () => {
        const clean = value.trim();
        if (clean === '') return;
        props.onSubmit(clean);
      };
      return h('input', {
        className: `smg-input${props.mono === true ? ' smg-mono' : ''}`,
        value,
        autoFocus: true,
        placeholder: props.placeholder,
        onChange: (event) => setValue(event.target.value),
        onKeyDown: (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            submit();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            props.onCancel();
          }
        },
        onBlur: () => {
          // Escape and Enter both unmount this field; a blur with no text cancels.
          if (value.trim() === '') props.onCancel();
        },
      });
    }

    function Bar(props) {
      const value = Math.max(0, Math.min(100, Number(props.value) || 0));
      const tone = value >= 90 ? ' smg-bar--crit' : value >= 70 ? ' smg-bar--warn' : '';
      return h('div', { className: `smg-bar${tone}` }, h('i', { style: { width: `${value}%` } }));
    }

    function Metric(props) {
      return h(
        'div',
        { className: 'smg-metric' },
        h('span', { className: 'smg-metricLabel' }, props.label),
        h('span', { className: 'smg-metricValue' }, props.value, props.unit === undefined ? null : h('small', null, ` ${props.unit}`)),
        props.percent === undefined ? null : h(Bar, { value: props.percent }),
      );
    }

    function formatSize(bytes) {
      if (!Number.isFinite(bytes)) return '';
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }

    function formatUptime(seconds) {      if (!Number.isFinite(seconds)) return '—';
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      if (days > 0) return `${days}d ${hours}h`;
      return `${hours}h ${Math.floor((seconds % 3600) / 60)}m`;
    }

    function clockOf(iso) {
      if (typeof iso !== 'string' || iso.length < 19) return '';
      return iso.slice(11, 19);
    }

    class Guard extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error) {
        return { error };
      }
      render() {
        if (this.state.error !== null) {
          return h('div', { className: 'smg-warnBox', style: { margin: '14px 18px' } }, `${PACKAGE_ID}: ${String(this.state.error?.message ?? this.state.error)}`);
        }
        return this.props.children;
      }
    }

    /* ---------------------------------------------------------------- *
     * server form
     * ---------------------------------------------------------------- */

    function emptyDraft(defaultGroup) {
      return {
        id: '', name: '', host: '', port: 22, user: 'root', group: defaultGroup ?? '',
        authType: 'key', password: '', privateKey: '', keyPath: '', passphrase: '',
        jump: '', note: '',
      };
    }

    function ServerForm(props) {
      const { draft, setDraft, groups, servers, onSaved, onCancel } = props;
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const isNew = draft.id === '';
      const patch = (values) => setDraft({ ...draft, ...values });
      const secretHint = isNew ? '' : ` · ${t.keep}`;

      const save = async () => {
        setError('');
        if (String(draft.name).trim() === '') return setError(t.needName);
        if (String(draft.host).trim() === '') return setError(t.needHost);
        setBusy(true);
        try {
          const next = await postJson(API.server, { action: 'upsert', ...draft });
          onSaved(next, draft.id);
        } catch (failure) {
          setError(failure.message);
        } finally {
          setBusy(false);
        }
      };

      const remove = async () => {
        setBusy(true);
        try {
          onSaved(await postJson(API.server, { action: 'delete', id: draft.id }), '');
        } catch (failure) {
          setError(failure.message);
        } finally {
          setBusy(false);
        }
      };

      return h(
        'div',
        { className: 'smg-card' },
        h(
          'div',
          { className: 'smg-cardHead' },
          h('span', { className: 'smg-cardTitle' }, isNew ? t.addServer : t.edit),
          h('span', { className: 'smg-cardGap' }),
          isNew ? null : h(ConfirmButton, { onConfirm: remove, disabled: busy, title: t.deleteServerConfirm }, t.remove),
        ),
        h(
          'div',
          { className: 'smg-formGrid' },
          h(Field, { label: t.name }, h('input', { className: 'smg-input', value: draft.name, onChange: (e) => patch({ name: e.target.value }), placeholder: 'web-01' })),
          h(Field, { label: t.host }, h('input', { className: 'smg-input smg-mono', value: draft.host, onChange: (e) => patch({ host: e.target.value }), placeholder: '10.0.0.12' })),
          h(Field, { label: t.port }, h('input', { className: 'smg-input', type: 'number', min: 1, max: 65535, value: draft.port, onChange: (e) => patch({ port: Number(e.target.value) || 22 }) })),
          h(Field, { label: t.user }, h('input', { className: 'smg-input smg-mono', value: draft.user, onChange: (e) => patch({ user: e.target.value }) })),
          h(Field, { label: t.group }, h('select', { className: 'smg-select', value: draft.group, onChange: (e) => patch({ group: e.target.value }) },
            h('option', { value: '' }, t.none),
            groups.map((group) => h('option', { key: group.id, value: group.id }, group.name)))),
          h(Field, { label: t.jump }, h('select', { className: 'smg-select', value: draft.jump, onChange: (e) => patch({ jump: e.target.value }) },
            h('option', { value: '' }, t.direct),
            servers.filter((s) => s.id !== draft.id).map((s) => h('option', { key: s.id, value: s.id }, s.name)))),
          h(Field, { label: t.authType }, h('select', { className: 'smg-select', value: draft.authType, onChange: (e) => patch({ authType: e.target.value }) },
            h('option', { value: 'key' }, t.authKey),
            h('option', { value: 'password' }, t.authPassword))),
          draft.authType === 'password'
            ? h(Field, { label: `${t.password}${secretHint}` }, h('input', { className: 'smg-input', type: 'password', autoComplete: 'new-password', value: draft.password, onChange: (e) => patch({ password: e.target.value }) }))
            : h(Field, { label: `${t.keyPath}${secretHint}` }, h('input', { className: 'smg-input smg-mono', value: draft.keyPath, onChange: (e) => patch({ keyPath: e.target.value }), placeholder: 'C:\\Users\\me\\.ssh\\id_ed25519' })),
          h(Field, { label: t.note, wide: true }, h('input', { className: 'smg-input', value: draft.note, onChange: (e) => patch({ note: e.target.value }) })),
          draft.authType === 'password' ? null : h(Field, { label: t.privateKey, wide: true },
            h('textarea', { className: 'smg-area', value: draft.privateKey, onChange: (e) => patch({ privateKey: e.target.value }), placeholder: '-----BEGIN OPENSSH PRIVATE KEY-----' })),
          draft.authType === 'password' ? null : h(Field, { label: t.passphrase },
            h('input', { className: 'smg-input', type: 'password', autoComplete: 'new-password', value: draft.passphrase, onChange: (e) => patch({ passphrase: e.target.value }) })),
        ),
        h(
          'div',
          { className: 'smg-formFoot' },
          h(Btn, { variant: 'primary', onClick: save, disabled: busy }, busy ? '…' : t.save),
          h(Btn, { onClick: onCancel, disabled: busy }, t.cancel),
        ),
        error === '' ? null : h('p', { className: 'smg-error', style: { marginTop: 8 } }, error),
        h('p', { className: 'smg-hint', style: { marginTop: 8 } }, t.credHint),
      );
    }

    /* ---------------------------------------------------------------- *
     * overview
     * ---------------------------------------------------------------- */

    /** Tiny SVG trend line; no chart library, no layout shift. */
    function Sparkline(props) {
      const points = (props.points ?? []).filter((value) => Number.isFinite(value));
      const max = props.max ?? 100;
      if (points.length < 2) {
        return h('svg', { className: 'smg-spark', viewBox: '0 0 100 30', preserveAspectRatio: 'none' });
      }
      const step = 100 / (points.length - 1);
      const line = points
        .map((value, index) => {
          const clamped = Math.max(0, Math.min(max, Number(value)));
          const y = 29 - (clamped / max) * 27;
          return `${(index * step).toFixed(2)},${y.toFixed(2)}`;
        })
        .join(' ');
      return h(
        'svg',
        { className: 'smg-spark', viewBox: '0 0 100 30', preserveAspectRatio: 'none' },
        h('polygon', { className: 'smg-sparkArea', points: `0,30 ${line} 100,30`, fill: props.color }),
        h('polyline', { className: 'smg-sparkLine', points: line, stroke: props.color }),
      );
    }

    const SEVERITY_WORD = {
      idle: () => t.statusIdle,
      ok: () => t.statusOk,
      warn: () => t.statusWarn,
      crit: () => t.statusCrit,
    };

    /**
     * Severity, computed here so the panel decides how alarming to look.
     * A failed systemd unit is a warning, not a crisis — plenty of hosts carry
     * a permanently failed wait-online unit and are perfectly healthy. Red is
     * reserved for "cannot reach it".
     */
    function severityOf(server) {
      const health = server?.health ?? null;
      if (health === null) return 'idle';
      if (health.ok !== true) return 'crit';
      const disk = typeof health.diskPercent === 'number' ? health.diskPercent : 0;
      const mem = typeof health.memPercent === 'number' ? health.memPercent : 0;
      const load = typeof health.loadPercent === 'number' ? health.loadPercent : 0;
      if (disk >= 95 || mem >= 97) return 'crit';
      if (disk >= 85 || mem >= 90 || load >= 150 || (health.failedUnits ?? 0) > 0) return 'warn';
      return 'ok';
    }

    function Overview(props) {
      const { server, groups, servers, journal, onRefreshJournal, history, onRefreshNow, updatedAt, monitorMode, onSetMode } = props;
      const health = server.health ?? null;
      const severity = severityOf(server);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const [runBusy, setRunBusy] = useState('');
      const [failedDetail, setFailedDetail] = useState('');
      const [failedBusy, setFailedBusy] = useState(false);
      const groupName = groups.find((g) => g.id === server.group)?.name ?? t.ungrouped;

      useEffect(() => {
        setError('');
      }, [server.id]);

      /** Names come from the health sweep; this asks the machine directly. */
      const inspectFailed = async () => {
        setFailedBusy(true);
        setError('');
        try {
          const result = await postJson(API.exec, {
            serverId: server.id,
            command: 'systemctl --failed --no-legend --no-pager 2>/dev/null | head -40',
          });
          setFailedDetail(String(result.stdout ?? '').trim() || '(没有失败单元)');
          onRefreshJournal();
        } catch (failure) {
          setError(failure.message);
        } finally {
          setFailedBusy(false);
        }
      };

      const probeNow = async () => {
        setBusy(true);
        setError('');
        try {
          await onRefreshNow();
        } catch (failure) {
          setError(failure.message);
        } finally {
          setBusy(false);
        }
      };

      const quick = async (command) => {
        setRunBusy(command);
        setError('');
        try {
          await postJson(API.exec, { serverId: server.id, command });
          onRefreshJournal();
          await onRefreshNow();
        } catch (failure) {
          setError(failure.message);
        } finally {
          setRunBusy('');
        }
      };

      const QUICK = [
        ['uptime && free -m | head -2', 'uptime'],
        ['df -h 2>/dev/null | grep -v tmpfs', 'disk'],
        ['systemctl --failed --no-pager 2>/dev/null | head -20', 'failed units'],
        ['docker ps --format "{{.Names}}\\t{{.Status}}" 2>/dev/null | head -20', 'docker'],
        ['ss -ltnp 2>/dev/null | head -20', 'listening'],
        ['tail -n 60 /var/log/syslog 2>/dev/null || journalctl -n 60 --no-pager 2>/dev/null', 'recent log'],
      ];

      const series = Array.isArray(history) ? history : [];
      const value = (key) => (health === null || health[key] === null || health[key] === undefined ? '—' : health[key]);

      return h(
        React.Fragment,
        null,
        h(
          'div',
          { className: 'smg-strip' },
          h('span', { className: `smg-dot smg-dot--${severity}` }),
          h('span', { className: 'smg-stripStat' }, h('span', { className: 'smg-stripNum' }, SEVERITY_WORD[severity]())),
          health === null
            ? null
            : h(
                React.Fragment,
                null,
                typeof health.latencyMs === 'number' && health.latencyMs > 0
                  ? h('span', { className: 'smg-stripStat' },
                      h('span', { className: 'smg-stripNum' }, health.latencyMs), h('span', null, 'ms'))
                  : null,
                typeof health.cores === 'number'
                  ? h('span', { className: 'smg-stripStat' },
                      h('span', { className: 'smg-stripNum' }, health.cores), h('span', null, t.cores))
                  : null,
              ),
          h('span', { className: 'smg-stripGap' }),
          h('span', { className: 'smg-live' }, h('span', { className: 'smg-liveDot' }),
            updatedAt === null || updatedAt === undefined ? t.never : `${t.updated} ${clockOf(updatedAt)}`),
          h('span', {
            className: `smg-tag ${monitorMode === 'metrics' ? 'smg-tag--warn' : 'smg-tag--ok'}`,
            title: monitorMode === 'metrics' ? t.modeMetricsHint : t.modeConnectHint,
          }, monitorMode === 'metrics' ? t.modeMetrics : t.modeConnect),
          h(Btn, {
            small: true,
            onClick: () => onSetMode(monitorMode === 'metrics' ? 'connect' : 'metrics'),
            disabled: busy,
          }, monitorMode === 'metrics' ? t.switchToConnect : t.switchToMetrics),
          h(Btn, { variant: 'primary', small: true, onClick: probeNow, disabled: busy },
            busy ? '…' : `⚡ ${t.probeNow}`),
        ),
        error === '' ? null : h('p', { className: 'smg-error' }, error),
        health === null
          ? h('div', { className: 'smg-card' },
              h('p', { className: 'smg-hint' }, monitorMode === 'metrics' ? t.noMetrics : t.connectOnlyEmpty))
          : health.ok !== true
            ? h('div', { className: 'smg-card' },
                h('div', { className: 'smg-cardHead' },
                  h('span', { className: 'smg-cardTitle' }, t.metrics),
                  h('span', { className: 'smg-cardGap' }),
                  h('span', { className: 'smg-tag smg-tag--crit' }, 'unreachable')),
                h('p', { className: 'smg-error' }, health.error ?? 'unreachable'),
                h('p', { className: 'smg-hint' }, `${server.user}@${server.host}:${server.port}`))
            : health.mode === 'connect'
              ? h('div', { className: 'smg-card' },
                  h('div', { className: 'smg-cardHead' },
                    h('span', { className: 'smg-cardTitle' }, t.metrics),
                    h('span', { className: 'smg-cardGap' }),
                    h('span', { className: 'smg-tag smg-tag--ok' }, t.modeConnect)),
                  h('div', { className: 'smg-metrics' },
                    typeof health.latencyMs === 'number' && health.latencyMs > 0
                      ? h(Metric, { label: t.latency, value: health.latencyMs, unit: 'ms' })
                      : null),
                  h('p', { className: 'smg-hint', style: { marginTop: 10 } }, t.connectOnlyEmpty))
            : h(
                React.Fragment,
                null,
                h(
                  'div',
                  { className: 'smg-card' },
                  h(
                    'div',
                    { className: 'smg-cardHead' },
                    h('span', { className: 'smg-cardTitle' }, t.metrics),
                    h('span', { className: 'smg-cardGap' }),
                    health.failedUnits > 0
                      ? h('button', {
                          type: 'button',
                          className: 'smg-tag smg-tag--crit',
                          style: { cursor: 'pointer', background: 'transparent' },
                          title: (health.failedNames ?? []).join('\n') || '点击查看详情',
                          onClick: inspectFailed,
                          disabled: failedBusy,
                        }, failedBusy
                          ? '…'
                          : (health.failedNames ?? []).length > 0
                            ? (health.failedNames ?? []).join(', ')
                            : `${health.failedUnits} ${t.failedUnits} →`)
                      : null,
                  ),
                  h(
                    'div',
                    { className: 'smg-metrics' },
                    h(Metric, {
                      label: `${t.load} ${health.cores === null ? '' : `/ ${health.cores}`}`.trim(),
                      value: value('load1'),
                      percent: health.loadPercent ?? undefined,
                    }),
                    h(Metric, {
                      label: t.mem,
                      value: value('memPercent'),
                      unit: '%',
                      percent: health.memPercent ?? undefined,
                    }),
                    h(Metric, {
                      label: t.swap,
                      value: health.swapPercent === null ? '—' : health.swapPercent,
                      unit: '%',
                      percent: health.swapPercent ?? undefined,
                    }),
                    h(Metric, {
                      label: t.disk,
                      value: value('diskPercent'),
                      unit: '%',
                      percent: health.diskPercent ?? undefined,
                    }),
                    h(Metric, { label: t.procs, value: value('processes') }),
                    h(Metric, { label: t.ports, value: value('listeningPorts') }),
                    h(Metric, { label: t.containers, value: health.dockerRunning === null ? '—' : health.dockerRunning }),
                    h(Metric, { label: t.users, value: health.loggedIn === null ? '—' : health.loggedIn }),
                    h(Metric, { label: t.uptime, value: formatUptime(health.uptimeSec) }),
                  ),
                  health.hotDisks !== undefined && health.hotDisks.length > 0
                    ? h(
                        'div',
                        { style: { marginTop: 12 } },
                        h('span', { className: 'smg-metricLabel' }, t.hotDisks),
                        h(
                          'div',
                          { className: 'smg-chips', style: { marginTop: 4 } },
                          health.hotDisks.map((disk) =>
                            h('span', {
                              key: disk.mount,
                              className: `smg-tag ${disk.percent >= 92 ? 'smg-tag--crit' : 'smg-tag--warn'}`,
                            }, `${disk.mount} ${disk.percent}%`),
                          ),
                        ),
                      )
                    : null,
                  failedDetail === ''
                    ? null
                    : h('pre', { className: 'smg-out', style: { marginTop: 10 } }, failedDetail),
                  h(
                    'dl',
                    { className: 'smg-kv', style: { marginTop: 12 } },
                    h('dt', null, t.platform),
                    h('dd', { className: 'smg-mono' }, health.platform || '—'),
                    h('dt', null, t.kernel),
                    h('dd', { className: 'smg-mono' }, health.kernel || '—'),
                    h('dt', null, t.group),
                    h('dd', null, groupName),
                    h('dt', null, t.jump),
                    h('dd', null, server.jump === '' ? t.direct : (servers.find((s) => s.id === server.jump)?.name ?? server.jump)),
                  ),
                ),
                h(
                  'div',
                  { className: 'smg-card' },
                  h('div', { className: 'smg-cardHead' },
                    h('span', { className: 'smg-cardTitle' }, t.trend),
                    h('span', { className: 'smg-cardGap' }),
                    h('span', { className: 'smg-hint' }, t.liveHint)),
                  h(
                    'div',
                    { className: 'smg-sparkWrap' },
                    h('div', { className: 'smg-sparkCard' },
                      h('div', { className: 'smg-sparkHead' },
                        h('span', null, t.load),
                        h('span', null, `${value('load1')}`)),
                      h(Sparkline, { points: series.map((point) => point.load), max: Math.max(2, (health.cores ?? 1) * 2), color: '#3b82f6' })),
                    h('div', { className: 'smg-sparkCard' },
                      h('div', { className: 'smg-sparkHead' },
                        h('span', null, t.mem),
                        h('span', null, `${health.memPercent ?? '—'}%`)),
                      h(Sparkline, { points: series.map((point) => point.mem), max: 100, color: '#2f9e5f' })),
                    h('div', { className: 'smg-sparkCard' },
                      h('div', { className: 'smg-sparkHead' },
                        h('span', null, t.disk),
                        h('span', null, `${health.diskPercent ?? '—'}%`)),
                      h(Sparkline, { points: series.map((point) => point.disk), max: 100, color: '#d9a12f' })),
                  ),
                ),
              ),
        h(
          'div',
          { className: 'smg-card' },
          h('div', { className: 'smg-cardHead' }, h('span', { className: 'smg-cardTitle' }, t.quick)),
          h(
            'div',
            { className: 'smg-chips' },
            QUICK.map(([command, label]) =>
              h('button', { key: label, type: 'button', className: 'smg-chip', onClick: () => quick(command), disabled: runBusy !== '' },
                runBusy === command ? '…' : label),
            ),
          ),
        ),
        h(
          'div',
          { className: 'smg-card' },
          h('div', { className: 'smg-cardHead' },
            h('span', { className: 'smg-cardTitle' }, t.recent),
            h('span', { className: 'smg-cardGap' }),
            h(Btn, { variant: 'ghost', small: true, onClick: onRefreshJournal }, '↻')),
          journal.length === 0
            ? h('p', { className: 'smg-hint' }, t.noJournal)
            : h(TimelineRows, { entries: journal.slice(0, 8) }),
        ),
      );
    }

    function TimelineRows(props) {
      const entries = props.entries ?? [];
      if (entries.length === 0) return h('p', { className: 'smg-hint' }, t.noJournal);
      return h(
        'div',
        { className: 'smg-tl' },
        entries.map((entry, index) =>
          h(
            'div',
            { key: `${entry.at}-${index}`, className: `smg-tlRow${Array.isArray(entry.risk) && entry.risk.length > 0 ? ' smg-tlRow--risk' : ''}` },
            h('span', { className: 'smg-tlTime' }, clockOf(entry.at)),
            h('span', { className: `smg-tag${entry.actor === 'agent' ? ' smg-tag--agent' : ''}` }, entry.actor === 'agent' ? t.byAgent : t.byPanel),
            h(
              'span',
              { className: 'smg-tlWhat smg-mono' },
              entry.action === 'exec' ? entry.command : `${entry.action} ${entry.path}`,
              Array.isArray(entry.risk) && entry.risk.length > 0
                ? h('span', { className: 'smg-tag smg-tag--risk', style: { marginLeft: 6 } }, entry.risk.join(' / '))
                : null,
            ),
            h(
              'span',
              { className: `smg-tag ${entry.ok === false ? 'smg-tag--fail' : 'smg-tag--ok'}` },
              entry.exitCode === null || entry.exitCode === undefined
                ? (entry.ok === false ? t.failed : t.ok)
                : `${t.exit} ${entry.exitCode}`,
            ),
          ),
        ),
      );
    }

    /* ---------------------------------------------------------------- *
     * console
     * ---------------------------------------------------------------- */

    /**
     * A small terminal emulator: honours \n, \r, \b and the handful of escape
     * sequences that matter for a shell (erase line, erase display), and drops
     * the rest. Not a full VT100 — `htop` will look rough — but `bash`, `cd`,
     * `ls`, `tail -f`, `vim` in a pinch all behave like a terminal.
     */
    function renderScreen(raw) {
      const rows = [[]];
      let row = 0;
      let col = 0;
      let index = 0;

      while (index < raw.length) {
        const ch = raw[index];

        if (ch === '\n') {
          row += 1;
          if (rows[row] === undefined) rows[row] = [];
          col = 0;
          index += 1;
          continue;
        }
        if (ch === '\r') {
          col = 0;
          index += 1;
          continue;
        }
        if (ch === '\b') {
          col = Math.max(0, col - 1);
          index += 1;
          continue;
        }
        if (ch === '\x07' || ch === '\x00') {
          index += 1;
          continue;
        }
        if (ch === '\x1b') {
          const next = raw[index + 1];
          if (next === '[') {
            let end = index + 2;
            while (end < raw.length && !/[A-Za-z@`{}~]/.test(raw[end])) end += 1;
            const sequence = raw.slice(index, end + 1);
            index = end + 1;
            if (sequence.startsWith('\x1b[2J') || sequence.startsWith('\x1b[3J')) {
              rows.length = 0;
              rows.push([]);
              row = 0;
              col = 0;
            } else if (sequence === '\x1b[K' || sequence === '\x1b[0K') {
              if (rows[row] !== undefined) rows[row] = rows[row].slice(0, col);
            } else if (sequence.startsWith('\x1b[') && /^[0-9]*G$/.test(sequence.slice(2))) {
              col = Math.max(0, Number(sequence.slice(2, -1) || 1) - 1);
            }
            continue;
          }
          if (next === ']') {
            let end = index + 2;
            while (end < raw.length && raw[end] !== '\x07' && !(raw[end] === '\x1b' && raw[end + 1] === '\\')) end += 1;
            index = end + 2;
            continue;
          }
          index += 2;
          continue;
        }

        if (rows[row] === undefined) rows[row] = [];
        rows[row][col] = ch;
        col += 1;
        index += 1;
      }

      const start = Math.max(0, rows.length - 4000);
      const lines = rows.slice(start).map((cells) => {
        const size = cells.length;
        let text = '';
        for (let i = 0; i < size; i += 1) text += cells[i] === undefined ? ' ' : cells[i];
        return text.replace(/\s+$/, '');
      });
      return {
        lines: lines.length === 0 ? [''] : lines,
        cursorRow: Math.min(Math.max(0, lines.length - 1), Math.max(0, row - start)),
        cursorCol: col,
      };
    }

    /**
     * Terminal sessions outlive the tab.
     *
     * Switching to another server and back must land in the same shell with its
     * scrollback, so the session is owned here by serverId rather than by the
     * component's lifetime. Only "断开", or the plugin unloading, closes it.
     */
    const shellRegistry = new Map();

    const shellFor = (serverId) => shellRegistry.get(serverId) ?? null;

    function dropShellEntry(serverId, closeRemote) {
      const entry = shellRegistry.get(serverId);
      if (entry === undefined) return;
      shellRegistry.delete(serverId);
      if (entry.source !== null) {
        try {
          entry.source.close();
        } catch {
          /* already closed */
        }
        entry.source = null;
      }
      if (closeRemote !== false && entry.shellId !== '') {
        postJson(API.shellClose, { shellId: entry.shellId }).catch(() => {});
      }
      entry.listeners.clear();
    }

    function closeAllShells() {
      for (const id of [...shellRegistry.keys()]) dropShellEntry(id, true);
    }

    const EMPTY_VIEW = { lines: [''], cursorRow: 0, cursorCol: 0 };

    /** Real PTY session over SSE; falls back to one-shot commands on demand. */
    function TerminalPane(props) {
      const { server } = props;
      const [mode, setMode] = useState('interactive');
      const [phase, setPhase] = useState('idle');
      const [error, setError] = useState('');
      const [view, setView] = useState(EMPTY_VIEW);
      const boxRef = useRef(null);
      const phaseRef = useRef('idle');
      phaseRef.current = phase;

      const attach = (entry) => {
        const paint = () => {
          setView(renderScreen(entry.chunks.join('')));
          if (entry.phase !== phaseRef.current) setPhase(entry.phase);
          if (entry.error !== '' && entry.error !== null) setError(entry.error);
        };
        entry.listeners.add(paint);
        paint();
        return () => entry.listeners.delete(paint);
      };

      const connect = async (force) => {
        const existing = shellFor(server.id);
        if (existing !== null && force !== true) {
          setPhase(existing.phase);
          setError(existing.error ?? '');
          return;
        }
        if (existing !== null) dropShellEntry(server.id, true);
        setError('');
        setPhase('connecting');
        setView(EMPTY_VIEW);

        const entry = {
          shellId: '',
          chunks: [],
          source: null,
          phase: 'connecting',
          error: '',
          listeners: new Set(),
        };
        shellRegistry.set(server.id, entry);

        try {
          const opened = await postJson(API.shellOpen, { serverId: server.id, cols: 120, rows: 34 });
          entry.shellId = opened.shellId;
          if (typeof EventSource === 'undefined') throw new Error('this build has no EventSource');
          const stream = new EventSource(`${apiUrl(API.shellStream)}?shellId=${encodeURIComponent(opened.shellId)}`);
          entry.source = stream;
          stream.onmessage = (event) => {
            let text = '';
            try {
              text = JSON.parse(event.data);
            } catch {
              text = event.data;
            }
            entry.chunks.push(text);
            if (entry.chunks.length > 4000) entry.chunks.splice(0, 2000);
            for (const notify of entry.listeners) notify();
          };
          stream.addEventListener('closed', () => {
            entry.phase = 'closed';
            for (const notify of entry.listeners) notify();
          });
          stream.onerror = () => {
            if (entry.phase === 'connecting') entry.error = 'stream failed to open';
          };
          entry.phase = 'open';
          if (shellRegistry.get(server.id) === entry) setPhase('open');
        } catch (failure) {
          entry.phase = 'idle';
          entry.error = failure.message;
          if (shellRegistry.get(server.id) === entry) {
            setError(failure.message);
            setPhase('idle');
          }
        }
      };

      const disconnect = () => {
        dropShellEntry(server.id, true);
        setView(EMPTY_VIEW);
        setPhase('closed');
      };

      useEffect(() => {
        let detach = () => {};
        let alive = true;
        const existing = shellFor(server.id);
        if (existing !== null && existing.shellId !== '') {
          setPhase(existing.phase);
          detach = attach(existing);
          return () => detach();
        }
        connect().then(() => {
          if (!alive) return;
          const created = shellFor(server.id);
          if (created !== null) {
            setPhase(created.phase);
            detach = attach(created);
          }
        });
        return () => {
          alive = false;
          detach();
          // Deliberately no teardown: leaving the tab keeps the shell alive.
        };
      }, [server.id]);

      useEffect(() => {
        const node = boxRef.current;
        if (node !== null) node.scrollTop = node.scrollHeight;
      }, [view]);

      const send = (data) => {
        const entry = shellFor(server.id);
        if (entry === null || entry.shellId === '') return;
        postJson(API.shellInput, { shellId: entry.shellId, data }).catch(() => {});
      };

      const onKeyDown = (event) => {
        let data = '';
        if (event.key === 'Enter') data = '\r';
        else if (event.key === 'Backspace') data = '\x7f';
        else if (event.key === 'Tab') data = '\t';
        else if (event.key === 'Escape') data = '\x1b';
        else if (event.key === 'ArrowUp') data = '\x1b[A';
        else if (event.key === 'ArrowDown') data = '\x1b[B';
        else if (event.key === 'ArrowRight') data = '\x1b[C';
        else if (event.key === 'ArrowLeft') data = '\x1b[D';
        else if (event.key === 'Home') data = '\x1b[H';
        else if (event.key === 'End') data = '\x1b[F';
        else if (event.key === 'Delete') data = '\x1b[3~';
        else if (event.ctrlKey && event.key.length === 1) {
          const code = event.key.toUpperCase().charCodeAt(0);
          if (code >= 64 && code <= 95) data = String.fromCharCode(code - 64);
        } else if (!event.ctrlKey && !event.metaKey && event.key.length === 1) {
          data = event.key;
        }
        if (data === '') return;
        event.preventDefault();
        send(data);
      };

      const blank = view.lines.length === 1 && view.lines[0] === '';

      return h(
        React.Fragment,
        null,
        h(
          'div',
          { className: 'smg-rowFlex' },
          h(Btn, {
            small: true,
            variant: mode === 'interactive' ? 'primary' : undefined,
            onClick: () => setMode('interactive'),
          }, t.termInteractive),
          h(Btn, {
            small: true,
            variant: mode === 'oneshot' ? 'primary' : undefined,
            onClick: () => setMode('oneshot'),
          }, t.termOneShot),
          h('span', { className: 'smg-cardGap' }),
          mode === 'interactive'
            ? phase === 'open'
              ? h(Btn, { small: true, onClick: disconnect }, t.termDisconnect)
              : h(Btn, {
                  small: true,
                  variant: 'primary',
                  onClick: () => connect(true),
                  disabled: phase === 'connecting',
                }, phase === 'connecting' ? t.termConnecting : t.termReconnect)
            : null,
        ),
        mode === 'oneshot'
          ? h(ConsolePane, { server })
          : h(
              React.Fragment,
              null,
              h(
                'div',
                {
                  className: 'smg-term',
                  ref: boxRef,
                  tabIndex: 0,
                  onKeyDown,
                  onClick: () => {
                    if (boxRef.current !== null) boxRef.current.focus();
                  },
                },
                blank
                  ? h('span', { className: 'smg-termHint' },
                      phase === 'closed'
                        ? t.termClosed
                        : phase === 'connecting'
                          ? t.termConnecting
                          : t.termNeedsFocus)
                  : view.lines.map((line, index) => {
                      if (index !== view.cursorRow) return h('div', { key: index }, line === '' ? ' ' : line);
                      const before = line.slice(0, view.cursorCol);
                      const at = line[view.cursorCol] === undefined ? ' ' : line[view.cursorCol];
                      const after = line.slice(view.cursorCol + 1);
                      return h('div', { key: index }, before, h('span', { className: 'smg-cursor' }, at), after);
                    }),
              ),
              h('p', { className: 'smg-hint' }, t.termHint),
            ),
        error === '' ? null : h('p', { className: 'smg-error' }, error),
      );
    }

    function ConsolePane(props) {
      const { server, onRan } = props;
      const [command, setCommand] = useState('');
      const [runs, setRuns] = useState([]);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const outRef = useRef(null);

      useEffect(() => {
        setRuns([]);
        setError('');
      }, [server.id]);

      useEffect(() => {
        const node = outRef.current;
        if (node !== null) node.scrollTop = node.scrollHeight;
      }, [runs]);

      const run = async () => {
        const text = command.trim();
        if (text === '' || busy) return;
        setBusy(true);
        setError('');
        try {
          const result = await postJson(API.exec, { serverId: server.id, command: text });
          setRuns((previous) => [...previous, result]);
          setCommand('');
          if (typeof onRan === 'function') onRan();
        } catch (failure) {
          setError(failure.message);
        } finally {
          setBusy(false);
        }
      };

      return h(
        React.Fragment,
        null,
        h(
          'div',
          { className: 'smg-rowFlex' },
          h('input', {
            className: 'smg-input smg-mono',
            value: command,
            placeholder: 'systemctl status nginx --no-pager',
            onChange: (event) => setCommand(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                run();
              }
            },
            disabled: busy,
          }),
          h(Btn, { variant: 'primary', onClick: run, disabled: busy }, busy ? t.running : t.run),
          h(Btn, { onClick: () => { setRuns([]); setError(''); }, disabled: busy || runs.length === 0 }, t.clear),
        ),
        h('p', { className: 'smg-hint' }, 'Ctrl+Enter 执行 · 每条命令都会进入时间线并归因到「面板」'),
        error === '' ? null : h('p', { className: 'smg-error' }, error),
        runs.length === 0
          ? null
          : h(
              'pre',
              { className: 'smg-out smg-out--term', ref: outRef },
              runs.map((entry, index) =>
                h(
                  'span',
                  { key: index },
                  h('span', { className: 'smg-prompt' }, '$ '),
                  entry.command,
                  '\n',
                  h('span', { className: `smg-exit${entry.exitCode === 0 ? '' : ' smg-exit--bad'}` },
                    `exit ${entry.exitCode === null ? '?' : entry.exitCode} · ${entry.durationMs} ms`),
                  '\n',
                  entry.stdout,
                  entry.stderr === '' ? '' : h('span', { className: 'smg-stderr' }, `\n[stderr]\n${entry.stderr}`),
                  '\n\n',
                ),
              ),
            ),
      );
    }

    /* ---------------------------------------------------------------- *
     * files
     * ---------------------------------------------------------------- */

    /** Remember each server's file browsing state, so switching back resumes it. */
    const filesMemory = new Map();

    function FilesPane(props) {
      const { server, onChanged } = props;
      const remembered = filesMemory.get(server.id);
      const [path, setPath] = useState(remembered?.path ?? '.');
      const [entries, setEntries] = useState(remembered?.entries ?? null);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const [note, setNote] = useState('');
      const [dirDraft, setDirDraft] = useState(false);
      const fileRef = useRef(null);

      useEffect(() => {
        const saved = filesMemory.get(server.id);
        setPath(saved?.path ?? '.');
        setEntries(saved?.entries ?? null);
        setError('');
        setNote('');
        setDirDraft(false);
      }, [server.id]);

      const list = async (target) => {
        const wanted = target === undefined ? path : target;
        setBusy(true);
        setError('');
        setNote('');
        try {
          const result = await postJson(API.ls, { serverId: server.id, path: wanted });
          setEntries(result.entries);
          setPath(result.path);
          filesMemory.set(server.id, { path: result.path, entries: result.entries });
        } catch (failure) {
          setError(failure.message);
        } finally {
          setBusy(false);
        }
      };

      const downloadFile = async (entry) => {
        setBusy(true);
        setError('');
        try {
          const result = await postJson(API.download, { serverId: server.id, remotePath: entry.path });
          const binary = atob(result.dataBase64);
          const bytes = new Uint8Array(binary.length);
          for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
          const url = URL.createObjectURL(new Blob([bytes]));
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = entry.name;
          document.body.appendChild(anchor);
          anchor.click();
          document.body.removeChild(anchor);
          setTimeout(() => URL.revokeObjectURL(url), 4000);
          setNote(`${t.download}: ${entry.name} (${formatSize(result.bytes)})`);
          if (typeof onChanged === 'function') onChanged();
        } catch (failure) {
          setError(failure.message);
        } finally {
          setBusy(false);
        }
      };

      const uploadFile = async (file) => {
        if (file === undefined || file === null) return;
        setBusy(true);
        setError('');
        try {
          const buffer = await file.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          let binary = '';
          const chunk = 0x8000;
          for (let index = 0; index < bytes.length; index += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
          }
          const target = path === '.' ? file.name : `${path.replace(/\/+$/, '')}/${file.name}`;
          const result = await postJson(API.upload, { serverId: server.id, remotePath: target, dataBase64: btoa(binary) });
          setNote(`${t.upload}: ${result.path} (${formatSize(result.bytes)})`);
          if (typeof onChanged === 'function') onChanged();
          await list();
        } catch (failure) {
          setError(failure.message);
        } finally {
          setBusy(false);
          if (fileRef.current !== null) fileRef.current.value = '';
        }
      };

      const makeDir = async (name) => {
        setDirDraft(false);
        setBusy(true);
        setError('');
        try {
          const target = path === '.' ? name : `${path.replace(/\/+$/, '')}/${name}`;
          await postJson(API.mkdir, { serverId: server.id, path: target });
          if (typeof onChanged === 'function') onChanged();
          await list();
        } catch (failure) {
          setError(failure.message);
        } finally {
          setBusy(false);
        }
      };

      return h(
        React.Fragment,
        null,
        h(
          'div',
          { className: 'smg-rowFlex' },
          h('input', {
            className: 'smg-input smg-mono',
            value: path,
            placeholder: '/etc/nginx',
            onChange: (event) => setPath(event.target.value),
            onKeyDown: (event) => { if (event.key === 'Enter') list(); },
          }),
          h(Btn, { onClick: () => list(), disabled: busy }, t.list),
        ),
        h(
          'div',
          { className: 'smg-rowFlex', style: { marginTop: 2 } },
          h(Btn, { small: true, onClick: () => fileRef.current && fileRef.current.click(), disabled: busy }, `↑ ${t.upload}`),
          h(Btn, { small: true, onClick: () => setDirDraft(true), disabled: busy }, t.mkdir),
          h(Btn, { small: true, onClick: () => list('..'), disabled: busy }, t.up),
          h('input', { ref: fileRef, type: 'file', style: { display: 'none' }, onChange: (event) => uploadFile(event.target.files && event.target.files[0]) }),
        ),
        dirDraft
          ? h(
              'div',
              { className: 'smg-rowFlex' },
              h(InlineInput, {
                placeholder: t.dirNamePrompt,
                onSubmit: (name) => makeDir(name),
                onCancel: () => setDirDraft(false),
              }),
            )
          : null,
        error === '' ? null : h('p', { className: 'smg-error' }, error),
        note === '' ? null : h('p', { className: 'smg-okText' }, note),
        entries === null
          ? h('p', { className: 'smg-hint' }, '点「列目录」查看远端文件；路径留空为登录目录。')
          : h(
              'div',
              { className: 'smg-list' },
              entries.length === 0
                ? h('div', { className: 'smg-empty' }, '空目录')
                : entries.map((entry) =>
                    h(
                      'div',
                      { key: entry.path, className: 'smg-fileRow' },
                      h('span', { className: 'smg-fileMeta', style: { width: 34 } }, entry.isDirectory ? 'dir' : formatSize(entry.size)),
                      h('span', { className: 'smg-fileName', onClick: () => list(entry.path), title: entry.path },
                        entry.isDirectory ? `${entry.name}/` : entry.name),
                      entry.isDirectory
                        ? null
                        : h(Btn, { variant: 'ghost', small: true, onClick: () => downloadFile(entry), disabled: busy }, '↓'),
                    ),
                  ),
            ),
      );
    }

    /* ---------------------------------------------------------------- *
     * timeline
     * ---------------------------------------------------------------- */

    function TimelinePane(props) {
      const { server, entries, filter, setFilter, busy, onReload } = props;
      return h(
        React.Fragment,
        null,
        h(
          'div',
          { className: 'smg-rowFlex' },
          h(Btn, { small: true, variant: filter === 'all' ? 'primary' : undefined, onClick: () => setFilter('all') }, t.filterAll),
          h(Btn, { small: true, variant: filter === 'risk' ? 'primary' : undefined, onClick: () => setFilter('risk') }, t.filterRisk),
          h(Btn, { small: true, variant: filter === 'agent' ? 'primary' : undefined, onClick: () => setFilter('agent') }, t.filterAgent),
          h('span', { className: 'smg-cardGap' }),
          h(Btn, { small: true, onClick: onReload, disabled: busy }, busy ? '…' : '↻'),
        ),
        h('p', { className: 'smg-hint' }, `${t.journalHint} · ${server.name}`),
        h(
          'div',
          { className: 'smg-card', style: { padding: '4px 6px' } },
          h(TimelineRows, { entries: entries }),
        ),
      );
    }

    /* ---------------------------------------------------------------- *
     * memory
     * ---------------------------------------------------------------- */

    function MemoryCard(props) {
      const { scope, id, label, onChanged } = props;
      const [memory, setMemory] = useState(null);
      const [summaryDraft, setSummaryDraft] = useState('');
      const [text, setText] = useState('');
      const [kind, setKind] = useState('fact');
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');

      useEffect(() => {
        let alive = true;
        setMemory(null);
        setError('');
        postJson(API.memory, { scope, id, action: 'read' })
          .then((result) => {
            if (!alive) return;
            setMemory(result.memory);
            setSummaryDraft(result.memory?.summary ?? '');
          })
          .catch((failure) => alive && setError(failure.message));
        return () => { alive = false; };
      }, [scope, id]);

      const apply = async (payload) => {
        setBusy(true);
        setError('');
        try {
          const result = await postJson(API.memory, { scope, id, ...payload });
          setMemory(result.memory);
          setSummaryDraft(result.memory?.summary ?? '');
          setText('');
          if (typeof onChanged === 'function') onChanged();
        } catch (failure) {
          setError(failure.message);
        } finally {
          setBusy(false);
        }
      };

      const removeEntry = async (entryKind, index) => {
        setBusy(true);
        setError('');
        try {
          const result = await postJson(API.memory, { scope, id, action: 'remove', kind: entryKind, index });
          setMemory(result.memory);
        } catch (failure) {
          setError(failure.message);
        } finally {
          setBusy(false);
        }
      };

      const facts = (memory?.facts ?? []).slice().reverse();
      const warnings = (memory?.warnings ?? []).slice().reverse();

      return h(
        'div',
        { className: 'smg-card' },
        h(
          'div',
          { className: 'smg-cardHead' },
          h('span', { className: 'smg-cardTitle' }, label),
          h('span', { className: 'smg-cardGap' }),
          h('span', { className: 'smg-tag' }, `${t.facts} ${facts.length}`),
          h('span', { className: 'smg-tag' }, `${t.warnings} ${warnings.length}`),
        ),
        memory === null
          ? h('p', { className: 'smg-hint' }, '…')
          : h(
              React.Fragment,
              null,
              h(Field, { label: t.memorySummary },
                h('input', {
                  className: 'smg-input',
                  value: summaryDraft,
                  placeholder: t.factPlaceholder,
                  onChange: (event) => setSummaryDraft(event.target.value),
                  onKeyDown: (event) => { if (event.key === 'Enter') apply({ action: 'summary', summary: summaryDraft }); },
                })),
              h('div', { style: { height: 8 } }),
              h(Btn, { small: true, onClick: () => apply({ action: 'summary', summary: summaryDraft }), disabled: busy }, t.saveSummary),
              warnings.length === 0 && facts.length === 0
                ? h('p', { className: 'smg-hint', style: { marginTop: 10 } }, t.memoryEmpty)
                : h(
                    'div',
                    { className: 'smg-memList', style: { marginTop: 10 } },
                    warnings.map((entry, index) =>
                      h('div', { key: `w${index}`, className: 'smg-memItem smg-memItem--warn' },
                        h('span', { className: 'smg-tag smg-tag--risk' }, '!'),
                        h('span', { className: 'smg-memText' }, entry.text),
                        h(Btn, { variant: 'ghost', small: true, onClick: () => removeEntry('warning', index), disabled: busy }, '×')),
                    ),
                    facts.map((entry, index) =>
                      h('div', { key: `f${index}`, className: 'smg-memItem' },
                        h('span', { className: 'smg-tag' }, '·'),
                        h('span', { className: 'smg-memText' }, entry.text),
                        h(Btn, { variant: 'ghost', small: true, onClick: () => removeEntry('fact', index), disabled: busy }, '×')),
                    ),
                  ),
              h('div', { className: 'smg-rowFlex', style: { marginTop: 12 } },
                h('select', { className: 'smg-select', style: { width: 96 }, value: kind, onChange: (event) => setKind(event.target.value) },
                  h('option', { value: 'fact' }, t.facts),
                  h('option', { value: 'warning' }, t.warnings)),
                h('input', {
                  className: 'smg-input',
                  value: text,
                  placeholder: kind === 'warning' ? t.warningPlaceholder : t.factPlaceholder,
                  onChange: (event) => setText(event.target.value),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter' && text.trim() !== '') apply({ action: 'add', kind, text });
                  },
                }),
                h(Btn, { small: true, onClick: () => text.trim() !== '' && apply({ action: 'add', kind, text }), disabled: busy || text.trim() === '' },
                  kind === 'warning' ? t.addWarning : t.addFact),
              ),
            ),
        error === '' ? null : h('p', { className: 'smg-error', style: { marginTop: 8 } }, error),
      );
    }

    function MemoryPane(props) {
      const { server, groups, onChanged } = props;
      const groupId = server.group;
      return h(
        React.Fragment,
        null,
        h('p', { className: 'smg-hint' }, t.agentTip),
        groupId === ''
          ? h('p', { className: 'smg-hint' }, '这台服务器未分组，所以没有组记忆。')
          : h(MemoryCard, {
              scope: 'group',
              id: groupId,
              label: `${t.memoryGroup} · ${groups.find((g) => g.id === groupId)?.name ?? groupId}`,
              onChanged,
            }),
        h(MemoryCard, { scope: 'server', id: server.id, label: `${t.memoryServer} · ${server.name}`, onChanged }),
      );
    }

    /* ---------------------------------------------------------------- *
     * page
     * ---------------------------------------------------------------- */

    function SshManagerPage() {
      const [state, setState] = useState(null);
      const [error, setError] = useState('');
      const [selectedId, setSelectedId] = useState('');
      const [tab, setTab] = useState('overview');
      const [draft, setDraft] = useState(null);
      const [loading, setLoading] = useState(true);
      const [query, setQuery] = useState('');
      const [journal, setJournal] = useState([]);
      const [journalBusy, setJournalBusy] = useState(false);
      const [journalFilter, setJournalFilter] = useState('all');
      const [groupDraft, setGroupDraft] = useState(false);
      const [renaming, setRenaming] = useState(null);
      const [history, setHistory] = useState({});
      const [updatedAt, setUpdatedAt] = useState(null);
      const reported = useRef(false);

      useEffect(() => {
        if (reported.current) return;
        reported.current = true;
        report('render');
      }, []);

      const load = async (quiet) => {
        if (quiet !== true) setError('');
        try {
          const next = await getJson(API.state);
          setState(next);
          setUpdatedAt(Date.now());
          setHistory((previous) => {
            const merged = { ...previous };
            for (const server of next.servers) {
              const health = server.health;
              if (health === null || health === undefined || health.ok !== true) continue;
              const point = {
                t: Date.now(),
                load: typeof health.load1 === 'number' ? health.load1 : null,
                mem: typeof health.memPercent === 'number' ? health.memPercent : null,
                disk: typeof health.diskPercent === 'number' ? health.diskPercent : null,
              };
              const series = merged[server.id] ?? [];
              const last = series[series.length - 1];
              if (last !== undefined && last.t === point.t) continue;
              merged[server.id] = [...series, point].slice(-40);
            }
            return merged;
          });
          setSelectedId((current) =>
            current !== '' && next.servers.some((server) => server.id === current) ? current : (next.servers[0]?.id ?? ''),
          );
        } catch (failure) {
          if (quiet !== true) setError(failure.message);
        } finally {
          setLoading(false);
        }
      };

      useEffect(() => {
        load();
      }, []);

      // Keep the panel live: the Host refreshes its health cache on its own
      // schedule, and this just re-reads it so the dots and metrics follow.
      useEffect(() => {
        const timer = setInterval(() => {
          if (typeof document !== 'undefined' && document.hidden) return;
          load(true);
        }, 20000);
        return () => clearInterval(timer);
      }, []);

      const servers = state?.servers ?? [];
      const groups = state?.groups ?? [];
      const monitorMode = state?.settings?.monitorMode === 'metrics' ? 'metrics' : 'connect';
      const selected = servers.find((server) => server.id === selectedId) ?? null;

      /** Monitoring mode is a setting, not a per-server toggle. */
      const setMonitorMode = async (mode) => {
        setError('');
        try {
          setState(await postJson(API.settings, { monitorMode: mode }));
        } catch (failure) {
          setError(failure.message);
        }
      };

      const loadJournal = async (serverId, filter) => {
        setJournalBusy(true);
        try {
          const result = await postJson(API.journal, {
            serverId: serverId ?? '',
            actor: filter === 'agent' ? 'agent' : '',
            riskyOnly: filter === 'risk',
            limit: 120,
          });
          setJournal(result.entries ?? []);
        } catch (failure) {
          setJournal([]);
        } finally {
          setJournalBusy(false);
        }
      };

      useEffect(() => {
        if (selected === null) {
          setJournal([]);
          return;
        }
        loadJournal(selected.id, journalFilter);
      }, [selected?.id, journalFilter]);

      const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (needle === '') return servers;
        return servers.filter((server) =>
          [server.name, server.host, server.user, server.note].join(' ').toLowerCase().includes(needle),
        );
      }, [servers, query]);

      const buckets = useMemo(() => {
        const list = groups.map((group) => ({
          id: group.id,
          name: group.name,
          servers: filtered.filter((server) => server.group === group.id),
        }));
        const loose = filtered.filter((server) => server.group === '' || !groups.some((g) => g.id === server.group));
        if (loose.length > 0) list.push({ id: '', name: t.ungrouped, servers: loose });
        return list;
      }, [groups, filtered]);

      const afterSave = (next, keepId) => {
        setState(next);
        setDraft(null);
        if (typeof keepId === 'string' && keepId !== '') setSelectedId(keepId);
        else if (next.servers.length > 0) setSelectedId(next.servers[0].id);
      };

      const addGroup = () => setGroupDraft(true);

      const commitGroup = async (name, id) => {
        setGroupDraft(false);
        setRenaming(null);
        setError('');
        try {
          setState(
            await postJson(API.group, id === undefined ? { action: 'upsert', name } : { action: 'upsert', id, name }),
          );
        } catch (failure) {
          setError(failure.message);
        }
      };

      const deleteGroup = async (id) => {
        setError('');
        try {
          setState(await postJson(API.group, { action: 'delete', id }));
        } catch (failure) {
          setError(failure.message);
        }
      };

      const openEdit = (server) => {
        setDraft({
          id: server.id, name: server.name, host: server.host, port: server.port, user: server.user,
          group: server.group, authType: server.authType, password: '', privateKey: '',
          keyPath: server.keyPath, passphrase: '', jump: server.jump, note: server.note,
        });
      };

      const refreshJournal = () => { if (selected !== null) loadJournal(selected.id, journalFilter); };

      /** Probe the selected server right now, then re-read the shared cache. */
      const refreshNow = async () => {
        if (selected === null) return;
        await postJson(API.monitor, { serverId: selected.id });
        await load(true);
      };

      const online = servers.filter(
        (entry) => entry.health !== null && entry.health !== undefined && entry.health.ok === true,
      ).length;

      const TABS = [
        ['overview', t.tabs.overview],
        ['console', t.tabs.console],
        ['files', t.tabs.files],
        ['timeline', t.tabs.timeline],
        ['memory', t.tabs.memory],
      ];

      return h(
        Guard,
        null,
        h(
          'div',
          { className: 'smg' },
          h(
            'div',
            { className: 'smg-head' },
            h(
              'div',
              { className: 'smg-brand' },
              h('h2', { className: 'smg-title' }, t.title),
              h('span', { className: 'smg-tagline' }, t.tagline),
            ),
            h('span', { className: 'smg-head-gap' }),
            servers.length === 0
              ? null
              : h(
                  'span',
                  { className: `smg-tag ${online === servers.length ? 'smg-tag--ok' : online === 0 ? 'smg-tag--crit' : 'smg-tag--warn'}` },
                  `${online}/${servers.length} ${t.onlineSummary}`,
                ),
            h('input', {
              className: 'smg-search',
              value: query,
              placeholder: t.search,
              onChange: (event) => setQuery(event.target.value),
            }),
            h(Btn, { onClick: addGroup }, `+ ${t.addGroup}`),
            h(Btn, { variant: 'primary', onClick: () => { setDraft(emptyDraft('')); setSelectedId(''); } }, `+ ${t.addServer}`),
            h(Btn, { variant: 'ghost', onClick: load, disabled: loading }, '↻'),
          ),
          error === '' ? null : h('p', { className: 'smg-error', style: { padding: '0 18px' } }, error),
          h(
            'div',
            { className: 'smg-body' },
            h(
              'div',
              { className: 'smg-rail' },
              h(
                React.Fragment,
                null,
                groupDraft
                  ? h(
                      'div',
                      { className: 'smg-railNew' },
                      h(InlineInput, {
                        placeholder: t.groupPlaceholder,
                        onSubmit: (name) => commitGroup(name),
                        onCancel: () => setGroupDraft(false),
                      }),
                    )
                  : null,
                servers.length === 0 && groups.length === 0
                  ? h('div', { className: 'smg-empty' }, t.noServers)
                  : buckets.map((bucket) => {
                      const key = bucket.id === '' ? '__loose' : bucket.id;
                      const isRenaming = renaming !== null && bucket.id !== '' && renaming.id === bucket.id;
                      return h(
                        'div',
                        { key, className: 'smg-railGroup' },
                        h(
                          'div',
                          { className: 'smg-railHead' },
                          isRenaming
                            ? h(
                                'div',
                                { style: { flex: 1 } },
                                h(InlineInput, {
                                  initial: bucket.name,
                                  onSubmit: (name) => commitGroup(name, bucket.id),
                                  onCancel: () => setRenaming(null),
                                }),
                              )
                            : h(
                                React.Fragment,
                                null,
                                h('span', null, bucket.name),
                                h('span', { className: 'smg-count' }, String(bucket.servers.length)),
                                h('span', { className: 'smg-grow' }),
                                bucket.id === ''
                                  ? null
                                  : h(
                                      React.Fragment,
                                      null,
                                      h('button', {
                                        type: 'button',
                                        className: 'smg-btn smg-btn--ghost smg-btn--sm',
                                        title: t.renamePrompt,
                                        onClick: () => setRenaming({ id: bucket.id, name: bucket.name }),
                                      }, '✎'),
                                      h(ConfirmButton, { onConfirm: () => deleteGroup(bucket.id), title: t.remove }, '✕'),
                                    ),
                              ),
                        ),
                        bucket.servers.map((server) =>
                          h(
                            'button',
                            {
                              key: server.id,
                              type: 'button',
                              className: `smg-row${server.id === selectedId && draft === null ? ' smg-row--active' : ''}`,
                              onClick: () => { setSelectedId(server.id); setDraft(null); setTab('overview'); },
                            },
                            h('span', { className: `smg-dot smg-dot--${severityOf(server)}` }),
                            h('span', { className: 'smg-rowMain' },
                              h('span', { className: 'smg-rowName' }, server.name),
                              h('span', { className: 'smg-rowSub' }, `${server.user}@${server.host}`)),
                            typeof server.health?.memPercent === 'number'
                              ? h('span', { className: 'smg-rowDot' }, `${server.health.memPercent}%`)
                              : null,
                          ),
                        ),
                      );
                    }),
                  ),
            ),
            h(
              'div',
              { className: 'smg-main' },
              draft !== null
                ? h('div', { className: 'smg-pane' },
                    h(ServerForm, { draft, setDraft, groups, servers, onSaved: afterSave, onCancel: () => setDraft(null) }))
                : selected === null
                  ? h('div', { className: 'smg-empty' }, t.pick)
                  : h(
                      React.Fragment,
                      null,
                      h(
                        'div',
                        { className: 'smg-tabs' },
                        TABS.map(([key, label]) =>
                          h('button', {
                            key,
                            type: 'button',
                            className: `smg-tab${tab === key ? ' smg-tab--active' : ''}`,
                            onClick: () => setTab(key),
                          }, label)),
                        h('span', { className: 'smg-tabsGap' }),
                        h(Btn, { variant: 'ghost', small: true, onClick: () => openEdit(selected) }, t.edit),
                      ),
                      h(
                        'div',
                        { className: 'smg-pane' },
                        tab === 'overview'
                          ? h(Overview, {
                              server: selected,
                              groups,
                              servers,
                              journal,
                              onRefreshJournal: refreshJournal,
                              history: history[selected.id] ?? [],
                              onRefreshNow: refreshNow,
                              updatedAt: selected.healthAt,
                              monitorMode,
                              onSetMode: setMonitorMode,
                            })
                          : tab === 'console'
                            ? h(TerminalPane, { server: selected, onRan: refreshJournal })
                            : tab === 'files'
                              ? h(FilesPane, { server: selected, onChanged: refreshJournal })
                              : tab === 'timeline'
                                ? h(TimelinePane, {
                                    server: selected,
                                    entries: journal,
                                    filter: journalFilter,
                                    setFilter: setJournalFilter,
                                    busy: journalBusy,
                                    onReload: refreshJournal,
                                  })
                                : h(MemoryPane, { server: selected, groups, onChanged: refreshJournal }),
                      ),
                    ),
            ),
          ),
        ),
      );
    }

    /* ---------------------------------------------------------------- *
     * icon
     * ---------------------------------------------------------------- */

    function TerminalIcon(props) {
      const size = typeof props?.size === 'number' ? props.size : 16;
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          focusable: 'false',
        },
        h('rect', { x: 1.6, y: 2.4, width: 12.8, height: 11.2, rx: 1.8 }),
        h('path', { d: 'M4.3 6.1 6.4 8l-2.1 1.9' }),
        h('path', { d: 'M8.3 9.9h3.4' }),
      );
    }

    /* ---------------------------------------------------------------- *
     * registration
     * ---------------------------------------------------------------- */

    function register(ctx) {
      if (ctx === null || ctx === undefined || ctx.slots === undefined) return;

      const page = () => h(SshManagerPage, null);

      try {
        ctx.slots.inject(SIDEBAR_SLOT, () =>
          ctx.slots.register(
            { name: SIDEBAR_SLOT, id: PANEL_ID, order: PANEL_ORDER, label: () => t.title },
            function SshSidebarRow(ownerProps) {
              const size = ownerProps !== null && typeof ownerProps === 'object' && typeof ownerProps.size === 'number' ? ownerProps.size : 16;
              return h(TerminalIcon, { size });
            },
          ));
      } catch (error) {
        console.error(`[${PACKAGE_ID}] sidebar row registration failed:`, error);
      }

      try {
        ctx.slots.inject(MAIN_SLOT, () =>
          ctx.slots.register({ name: MAIN_SLOT, key: PANEL_ID }, function SshMainPanel() { return page(); }));
      } catch (error) {
        console.error(`[${PACKAGE_ID}] main panel registration failed:`, error);
      }

      try {
        ctx.slots.inject(SETTINGS_SLOT, () =>
          ctx.slots.register(
            { name: SETTINGS_SLOT, id: ENTRY_ID, order: ENTRY_ORDER, label: () => t.title },
            function SettingsSection() { return page(); },
          ));
      } catch (error) {
        console.error(`[${PACKAGE_ID}] settings section registration failed:`, error);
      }

      try {
        ctx.slots.inject(BUNDLE_SLOT, () =>
          ctx.slots.register({ name: BUNDLE_SLOT, key: PACKAGE_ID, label: () => t.title }, function BundleConfig() {
            return page();
          }));
      } catch (error) {
        console.error(`[${PACKAGE_ID}] bundle page registration failed:`, error);
      }

      try {
        ctx.slots.inject(SETTINGS_ICON_SLOT, () =>
          ctx.slots.register(
            { name: SETTINGS_ICON_SLOT, id: ENTRY_ID, order: ENTRY_ORDER, label: () => t.title },
            TerminalIcon,
          ));
      } catch (error) {
        console.error(`[${PACKAGE_ID}] settings icon registration failed:`, error);
      }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        installStyles();
        register(ctx);
        if (!reportedApply) {
          reportedApply = true;
          report('apply');
        }
        if (typeof ctx?.effect === 'function') {
          ctx.effect(() => () => {
            closeAllShells();
            removeStyles();
          });
        }
      },
    };
  },
});
