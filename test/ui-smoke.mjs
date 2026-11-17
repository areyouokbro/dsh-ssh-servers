/**
 * A tiny React-compatible renderer, enough to mount the panel, dispatch a
 * click, and re-render. It exists so "I clicked and nothing happened" can be
 * reproduced here instead of in the user's window.
 */

const hooks = new Map();
let dirty = false;
let currentKey = '';
let hookIndex = 0;
const effectQueue = [];
// Component identity: stable ordinal per component type per render pass, so a
// tree reshuffle does not silently reset a component's hooks.
let typeCounters = new Map();

const React = {
  Fragment: Symbol('Fragment'),
  createElement(type, props, ...children) {
    const flat = [];
    const push = (value) => {
      if (value === null || value === undefined || value === false || value === true) return;
      if (Array.isArray(value)) value.forEach(push);
      else flat.push(value);
    };
    push(children);
    const merged = { ...(props ?? {}) };
    if (flat.length === 1) merged.children = flat[0];
    else if (flat.length > 1) merged.children = flat;
    return { type, props: merged, children: flat };
  },
  useState(initial) {
    const list = hooks.get(currentKey) ?? [];
    hooks.set(currentKey, list);
    const slot = hookIndex;
    hookIndex += 1;
    if (!(slot in list)) list[slot] = typeof initial === 'function' ? initial() : initial;
    const set = (next) => {
      const value = typeof next === 'function' ? next(list[slot]) : next;
      if (value === list[slot]) return;
      list[slot] = value;
      dirty = true;
    };
    return [list[slot], set];
  },
  useEffect(fn, deps) {
    const list = hooks.get(currentKey) ?? [];
    hooks.set(currentKey, list);
    const slot = hookIndex;
    hookIndex += 1;
    const previous = list[slot];
    const changed =
      previous === undefined ||
      deps === undefined ||
      previous.deps === undefined ||
      deps.length !== previous.deps.length ||
      deps.some((value, index) => value !== previous.deps[index]);
    list[slot] = { deps };
    if (changed) effectQueue.push({ key: currentKey, fn });
  },
  useMemo(factory) {
    hookIndex += 1;
    return factory();
  },
  useRef(initial) {
    const list = hooks.get(currentKey) ?? [];
    hooks.set(currentKey, list);
    const slot = hookIndex;
    hookIndex += 1;
    if (!(slot in list)) list[slot] = { current: initial };
    return list[slot];
  },
  Component: class {
    constructor(props) {
      this.props = props;
      this.state = {};
    }
    setState(next) {
      this.state = { ...this.state, ...next };
      dirty = true;
    }
  },
};

function renderNode(node, path) {
  if (node === null || node === undefined || node === false || node === true) return null;
  if (typeof node === 'string' || typeof node === 'number') return { text: String(node) };
  if (Array.isArray(node)) return node.map((child, index) => renderNode(child, `${path}.${index}`)).filter(Boolean);

  const { type, props, children } = node;

  if (type === React.Fragment) {
    return children.map((child, index) => renderNode(child, `${path}.${index}`)).filter(Boolean);
  }

  if (typeof type === 'function') {
    const ordinal = typeCounters.get(type) ?? 0;
    typeCounters.set(type, ordinal + 1);
    const key = `${type.name || 'anon'}#${ordinal}`;
    const savedKey = currentKey;
    const savedIndex = hookIndex;
    currentKey = key;
    hookIndex = 0;
    let output;
    try {
      if (type.prototype && typeof type.prototype.render === 'function') {
        const instance = new type(props);
        instance.props = props;
        output = instance.render();
      } else {
        output = type(props);
      }
    } finally {
      currentKey = savedKey;
      hookIndex = savedIndex;
    }
    return renderNode(output, `${path}>${type.name || 'a'}`);
  }

  return { type, props, children: children.map((child, index) => renderNode(child, `${path}.${index}`)).filter(Boolean) };
}

function renderRoot(element) {
  dirty = false;
  effectQueue.length = 0;
  hookIndex = 0;
  currentKey = 'root';
  typeCounters = new Map();
  let tree = renderNode(element, 'root');
  for (let pass = 0; pass < 8; pass += 1) {
    const pending = effectQueue.splice(0, effectQueue.length);
    for (const effect of pending) {
      const savedKey = currentKey;
      currentKey = effect.key;
      try {
        effect.fn();
      } catch (error) {
        console.log('  [effect threw]', error.message);
      }
      currentKey = savedKey;
    }
    if (!dirty) break;
    // A fresh pass must allocate the same ordinals as the first one, or the
    // component keys drift and every hook silently resets.
    typeCounters = new Map();
    tree = renderNode(element, 'root');
  }
  return tree;
}

function walk(tree, visit) {
  const nodes = Array.isArray(tree) ? tree.flat(Infinity) : [tree];
  for (const node of nodes) {
    if (node === null || node === undefined) continue;
    visit(node);
    if (Array.isArray(node.children)) for (const child of node.children) walk(child, visit);
  }
}

function texts(tree) {
  const out = [];
  walk(tree, (node) => {
    if (node.text !== undefined) out.push(node.text);
  });
  return out;
}

const findButtons = (tree) => {
  const out = [];
  walk(tree, (node) => {
    if (node.type === 'button') out.push(node);
  });
  return out;
};

const findInputs = (tree) => {
  const out = [];
  walk(tree, (node) => {
    if (node.type === 'input' || node.type === 'textarea' || node.type === 'select') out.push(node);
  });
  return out;
};

const labelOf = (button) => texts(button).join(' ').trim();
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

/* ------------------------------------------------------------------ */

const calls = [];
let stateMode = 'empty';

const HEALTHY = {
  id: 'srv_1', name: 'web-01', host: '10.0.0.5', port: 22, user: 'root',
  group: 'grp_1', authType: 'password', hasPassword: true, hasPrivateKey: false,
  keyPath: '', hasPassphrase: false, jump: '', tags: [], note: '',
  createdAt: 1, updatedAt: 1,
  health: {
    serverId: 'srv_1', server: 'web-01', group: 'grp_1', ok: true, latencyMs: 120,
    platform: 'Linux 6.1.0', kernel: '6.1.0', load: '0.42 0.30 0.25', load1: 0.42,
    loadPercent: 21, cores: 2, memUsedMb: 640, memTotalMb: 1900, memPercent: 34,
    swapPercent: 2, diskPercent: 47, hotDisks: [{ mount: '/data', percent: 88 }],
    uptimeSec: 604800, processes: 118, failedUnits: 0, dockerRunning: 2,
    listeningPorts: 9, loggedIn: 1, timezone: 'UTC',
  },
  healthAt: Date.now(), healthAgeMs: 1200, severity: 'ok',
};

globalThis.EventSource = class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.closed = false;
    setTimeout(() => {
      if (this.closed) return;
      if (typeof this.onmessage === 'function') this.onmessage({ data: JSON.stringify('$ hello\r\n') });
    }, 5);
  }
  addEventListener(name, fn) {
    const list = this.listeners.get(name) ?? [];
    list.push(fn);
    this.listeners.set(name, list);
  }
  close() {
    this.closed = true;
  }
};

const SECOND = {
  ...HEALTHY,
  id: 'srv_2',
  name: 'db-01',
  host: '10.0.0.9',
  health: { ...HEALTHY.health, serverId: 'srv_2', server: 'db-01', memPercent: 71, diskPercent: 63 },
};

globalThis.fetch = async (url, options = {}) => {
  const path = String(url);
  const method = options.method ?? 'GET';
  const body = options.body === undefined ? null : JSON.parse(options.body);
  calls.push({ path, method, body });

  let payload = {};
  if (path.endsWith('/state')) {
    const many = stateMode === 'two';
    payload =
      stateMode === 'empty'
        ? { version: 1, groups: [], servers: [], storePath: 'C:\\tmp\\store.json', pool: 0, healthIntervalMs: 20000 }
        : {
            version: 1,
            groups: [{ id: 'grp_1', name: 'prod', color: '', order: 0 }],
            servers: many ? [HEALTHY, SECOND] : [HEALTHY],
            storePath: 'C:\\tmp\\store.json',
            pool: 1,
            healthIntervalMs: 20000,
          };
  } else if (path.endsWith('/group')) {
    payload = { version: 1, groups: [{ id: 'grp_1', name: body?.name ?? 'x', color: '', order: 0 }], servers: [] };
  } else if (path.endsWith('/monitor')) {
    payload = { rows: [HEALTHY.health], severity: 'ok' };
  } else if (path.endsWith('/journal')) {
    payload = { entries: [], summary: { sampled: 0, risky: 0, failed: 0, last: null } };
  } else if (path.endsWith('/shell/open')) {
    payload = { shellId: 'sh_test', cols: 120, rows: 34, server: 'web-01' };
  } else if (path.endsWith('/client-hello')) {
    payload = { ok: true };
  }
  if (path.endsWith('/state')) console.log(`  [GET /state -> ${payload.servers?.length ?? '?'} servers, mode=${stateMode}]`);
  return { ok: true, json: async () => payload };
};

const fakeNavigator = { language: 'zh-CN' };
const fakeDocument = {
  head: { appendChild() {} },
  createElement: () => ({ setAttribute() {} }),
  baseURI: 'http://127.0.0.1:55660/',
  body: { appendChild() {}, removeChild() {} },
  querySelector: () => null,
};
const fakeLocation = { href: 'dsh-app://app/' };

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

let mount = null;
globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      const module = definition.factory((name) => {
        if (name === 'react') return React;
        throw new Error(`unexpected module ${name}`);
      });
      const registered = [];
      module.apply({
        slots: {
          inject: (_owner, install) => {
            const dispose = install();
            return () => typeof dispose === 'function' && dispose();
          },
          register: (options, Component) => {
            registered.push({ options, Component });
            return () => {};
          },
        },
        effect: (fn) => {
          const dispose = fn();
          return () => typeof dispose === 'function' && dispose();
        },
      });
      mount = registered.find((entry) => entry.options.name === 'main');
    },
  },
};

const source = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8');
new Function('window', 'navigator', 'document', 'location', source)(globalThis.window, fakeNavigator, fakeDocument, fakeLocation);

if (mount === undefined) {
  console.log('FAIL: main slot did not register');
  process.exit(1);
}

const element = React.createElement(mount.Component, {});
let tree = renderRoot(element);
await settle();
tree = renderRoot(element);

console.log('=== 1. empty inventory ===');
const allText = texts(tree).join(' | ');
console.log('empty hint shown :', allText.includes('还没有服务器'));
console.log('inputs           :', findInputs(tree).length);
console.log('buttons          :', findButtons(tree).map(labelOf).join(' / '));

console.log('');
console.log('=== 2. click the group button ===');
const groupButton = findButtons(tree).find((button) => labelOf(button).includes('分组'));
if (groupButton === undefined) {
  console.log('FAIL: no group button on screen');
  process.exit(1);
}
groupButton.props.onClick();
tree = renderRoot(element);

const afterClick = findInputs(tree);
const groupInput = afterClick.find((node) => String(node.props.placeholder ?? '').includes('分组'));
console.log('inputs after click:', afterClick.length);
console.log('group input shown :', groupInput !== undefined);
if (groupInput !== undefined) console.log('placeholder       :', groupInput.props.placeholder);

if (groupInput === undefined) {
  console.log('FAIL: clicking did not reveal the input');
  process.exit(1);
}

console.log('');
console.log('=== 3. type and press Enter ===');
groupInput.props.onChange({ target: { value: 'prod' } });
tree = renderRoot(element);
const typed = findInputs(tree).find((node) => String(node.props.placeholder ?? '').includes('分组'));
console.log('input value       :', JSON.stringify(typed.props.value));
typed.props.onKeyDown({ key: 'Enter', preventDefault() {} });
await settle();
tree = renderRoot(element);

const groupCall = calls.find((call) => call.method === 'POST' && call.path.endsWith('/group'));
console.log('POST /group       :', groupCall === undefined ? 'NOT SENT' : JSON.stringify(groupCall.body));
console.log('group row visible :', texts(tree).join(' ').includes('prod'));

console.log('');
console.log('=== 4. server form opens ===');
const serverButton = findButtons(tree).find((button) => labelOf(button).includes('服务器'));
if (serverButton === undefined) {
  console.log('FAIL: no server button');
  process.exit(1);
}
serverButton.props.onClick();
tree = renderRoot(element);
const formInputs = findInputs(tree);
console.log('form fields       :', formInputs.length);
console.log('host field present:', formInputs.some((node) => String(node.props.placeholder ?? '') === '10.0.0.12'));
console.log('save button       :', findButtons(tree).some((button) => labelOf(button) === '保存'));

console.log('');
console.log('=== 5. live data: metrics, trend, terminal ===');
stateMode = 'loaded';
// Leave the form opened in step 4 so the overview is what renders next.
const cancelForm = findButtons(tree).find((button) => labelOf(button) === '取消');
if (cancelForm !== undefined) cancelForm.props.onClick();
tree = renderRoot(element);
// Re-reading state is now an explicit action, exactly like the refresh button.
const reload = findButtons(tree).find((button) => labelOf(button) === '↻');
if (reload !== undefined) reload.props.onClick();
await settle();
tree = renderRoot(element);
await settle();
tree = renderRoot(element);

const labels = texts(tree).join(' | ');
console.log('online badge      :', labels.includes('1/1'));
console.log('severity word     :', labels.includes('在线'));
console.log('has probe button  :', findButtons(tree).some((button) => labelOf(button).includes('测连接')));
console.log('has trend card    :', labels.includes('趋势'));
console.log('sparkline svg     :', (() => {
  let found = 0;
  walk(tree, (node) => {
    if (node.type === 'svg' && String(node.props.className ?? '').includes('smg-spark')) found += 1;
  });
  return found;
})());
console.log('mem metric shown  :', labels.includes('34'));

const serverRow = findButtons(tree).find((button) => labelOf(button).includes('web-01'));
if (serverRow === undefined) {
  console.log('FAIL: server row missing');
  process.exit(1);
}
serverRow.props.onClick();
tree = renderRoot(element);

const termTab = findButtons(tree).find((button) => labelOf(button) === '终端');
if (termTab === undefined) {
  console.log('FAIL: terminal tab missing');
  process.exit(1);
}
termTab.props.onClick();
await settle();
tree = renderRoot(element);
await settle();
tree = renderRoot(element);
console.log('clicked tab       :', JSON.stringify(labelOf(termTab)));
console.log('pick hint shown   :', texts(tree).join('|').includes('从左边选一台'));
console.log('buttons now       :', findButtons(tree).map(labelOf).join(' / '));

const termLabels = texts(tree).join(' | ');
console.log('terminal toolbar  :', termLabels.includes('交互式') && termLabels.includes('单条命令'));
const opened = calls.find((call) => call.path.endsWith('/shell/open'));
console.log('shell/open called :', opened !== undefined ? JSON.stringify(opened.body) : 'NO');
let terminalBox = 0;
walk(tree, (node) => {
  if (String(node.props?.className ?? '').includes('smg-term')) terminalBox += 1;
});
console.log('terminal surface  :', terminalBox > 0);
console.log('error surfaced    :', texts(tree).some((text) => String(text).includes('EventSource')) ? '(no EventSource in node — expected)' : '(none)');

console.log('');
console.log('=== 6. switching servers must not rebuild the shell ===');
const openedCount = () => calls.filter((call) => call.path.endsWith('/shell/open')).length;
const openedAfterFirst = openedCount();
let cursors = 0;
walk(tree, (node) => {
  if (String(node.props?.className ?? '').includes('smg-cursor')) cursors += 1;
});
console.log('shell/open count  :', openedAfterFirst);
const termText = texts(tree).join('|');
console.log('prompt text landed:', termText.includes('hello'));
console.log('terminal box count:', (() => {
  let n = 0;
  walk(tree, (node) => {
    if (node.type === 'div' && String(node.props?.className ?? '') === 'smg-term') n += 1;
  });
  return n;
})());
console.log('cursor rendered   :', cursors > 0 ? 'yes (blinking block)' : 'NO');

stateMode = 'two';
tree = renderRoot(element);
const reloadTwo = findButtons(tree).find((button) => labelOf(button) === '↻');
if (reloadTwo !== undefined) reloadTwo.props.onClick();
await settle();
tree = renderRoot(element);
await settle();
tree = renderRoot(element);

const dbRow = findButtons(tree).find((button) => labelOf(button).includes('db-01'));
if (dbRow === undefined) {
  console.log('FAIL: second server row missing');
  process.exit(1);
}
dbRow.props.onClick();
tree = renderRoot(element);
const termTab2 = findButtons(tree).find((button) => labelOf(button) === '终端');
termTab2.props.onClick();
await settle();
tree = renderRoot(element);
console.log('after opening db-01:', openedCount(), openedCount() === openedAfterFirst + 1 ? '(new shell — correct)' : '(unexpected)');

const webRow = findButtons(tree).find((button) => labelOf(button).includes('web-01'));
webRow.props.onClick();
tree = renderRoot(element);
const termTab3 = findButtons(tree).find((button) => labelOf(button) === '终端');
termTab3.props.onClick();
await settle();
tree = renderRoot(element);
console.log('back to web-01    :', openedCount(), openedCount() === openedAfterFirst + 1 ? '(reused — no rebuild)' : '(REBUILT — persistence broken)');
let stillCursor = 0;
walk(tree, (node) => {
  if (String(node.props?.className ?? '').includes('smg-cursor')) stillCursor += 1;
});
console.log('scrollback kept   :', stillCursor > 0 ? 'yes' : 'NO');

// The panel arms a 20s poll interval; the assertions are done, so stop here
// rather than waiting for Node to notice there is nothing left to do.
process.exit(0);
