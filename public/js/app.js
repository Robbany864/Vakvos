/**
 * Termux CPanel — Main UI Controller
 */

/* ────────── Utilities ────────── */
const $  = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

function toast(message, type = 'info', ms = 3500) {
  const icons = { success: 'check-circle-2', error: 'alert-circle', info: 'info' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<i data-lucide="${icons[type] || 'info'}" class="w-4 h-4 shrink-0"></i><span>${message}</span>`;
  $('#toasts').appendChild(el);
  lucide.createIcons();
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    el.style.transition = 'all 0.25s';
    setTimeout(() => el.remove(), 300);
  }, ms);
}

function fmtBytes(n) {
  if (!n || n < 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 2)} ${u[i]}`;
}

function fmtDuration(sec) {
  sec = Math.floor(sec);
  const d = Math.floor(sec / 86400); sec %= 86400;
  const h = Math.floor(sec / 3600);  sec %= 3600;
  const m = Math.floor(sec / 60);    sec %= 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* ────────── Navigation ────────── */
const VIEWS = ['dashboard', 'files', 'editor', 'git', 'tunnel', 'logs'];
const VIEW_TITLES = {
  dashboard: 'System Overview',
  files: 'File Manager',
  editor: 'Code Editor',
  git: 'GitHub Deployer',
  tunnel: 'Cloudflare Tunnel & Domains',
  logs: 'Application Logs'
};

function showView(name) {
  if (!VIEWS.includes(name)) name = 'dashboard';
  VIEWS.forEach((v) => {
    $(`#view-${v}`).classList.toggle('hidden', v !== name);
  });
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  $('#view-title').textContent = VIEW_TITLES[name];

  // Close mobile sidebar
  $('#sidebar').classList.add('-translate-x-full');
  $('#overlay').classList.add('hidden');

  if (name === 'dashboard') loadDashboard();
  if (name === 'files') loadFiles(currentPath);
  if (name === 'git') loadDeployedSites();
  if (name === 'tunnel') refreshTunnelStatus();
  if (name === 'logs') loadAppLogs();
}

/* ────────── Dashboard ────────── */
async function loadDashboard() {
  try {
    const { cpu, memory, storage, os, node } = await api('/system');

    $('#stat-cpu').textContent = `${cpu.usage.toFixed(1)}%`;
    $('#bar-cpu').style.width = `${Math.min(cpu.usage, 100)}%`;

    $('#stat-ram').textContent = `${memory.usagePercent.toFixed(1)}%`;
    $('#bar-ram').style.width = `${Math.min(memory.usagePercent, 100)}%`;
    $('#stat-ram').title = `${fmtBytes(memory.used)} / ${fmtBytes(memory.total)}`;

    if (storage) {
      $('#stat-storage').textContent = `${storage.usagePercent.toFixed(1)}%`;
      $('#bar-storage').style.width = `${Math.min(storage.usagePercent, 100)}%`;
      $('#stat-storage').title = `${fmtBytes(storage.used)} / ${fmtBytes(storage.total)}`;
    } else {
      $('#stat-storage').textContent = 'N/A';
    }

    $('#stat-uptime').textContent = fmtDuration(node.uptime);
    $('#stat-node').textContent = `Node ${node.version} • PID ${node.pid}`;

    const info = [
      ['Platform', `${os.distro} ${os.release}`],
      ['Architecture', os.arch],
      ['Hostname', os.hostname],
      ['CPU Cores', cpu.cores],
      ['RAM Total', fmtBytes(memory.total)],
      ['Free RAM', fmtBytes(memory.free)],
      ['Storage Mount', storage?.mount || 'N/A'],
      ['Free Storage', storage ? fmtBytes(storage.free) : 'N/A']
    ];
    $('#sys-info').innerHTML = info
      .map(([k, v]) => `<div class="flex justify-between gap-4"><dt class="text-slate-400">${k}</dt><dd class="font-medium text-right">${escapeHtml(v)}</dd></div>`)
      .join('');

    // Sites
    const { sites } = await api('/sites');
    $('#sites-list').innerHTML = sites.length
      ? sites.map((s) => `
          <div class="flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-white/5">
            <div class="min-w-0">
              <div class="font-medium truncate">${escapeHtml(s.name)}</div>
              <div class="text-[11px] text-slate-400 truncate">${escapeHtml(s.path)}</div>
            </div>
            <a href="/site/${encodeURIComponent(s.name)}/" target="_blank" class="btn-icon shrink-0" title="Open">
              <i data-lucide="external-link" class="w-3.5 h-3.5"></i>
            </a>
          </div>`).join('')
      : '<p class="text-xs text-slate-500">No sites deployed yet.</p>';

    lucide.createIcons();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ────────── File Manager ────────── */
let currentPath = '';

async function loadFiles(relPath = '') {
  try {
    currentPath = relPath;
    const data = await api(`/files?path=${encodeURIComponent(relPath)}`);
    $('#breadcrumb').textContent = '/www' + (data.path ? '/' + data.path : '');

    const rows = [];

    if (data.path) {
      rows.push(`
        <tr class="cursor-pointer" data-action="up">
          <td colspan="4" class="py-2 pr-3">
            <div class="flex items-center gap-2 text-slate-300 hover:text-white">
              <i data-lucide="corner-left-up" class="w-4 h-4"></i>
              <span>..</span>
            </div>
          </td>
        </tr>`);
    }

    data.entries.forEach((e) => {
      const iconName = e.type === 'directory' ? 'folder' : iconForFile(e.name);
      const iconColor = e.type === 'directory' ? 'text-indigo-400' : 'text-slate-400';
      rows.push(`
        <tr data-name="${escapeHtml(e.name)}" data-type="${e.type}" data-path="${escapeHtml(e.path)}">
          <td class="py-2 pr-3">
            <div class="flex items-center gap-2 min-w-0 cursor-pointer ${e.type === 'directory' ? 'folder-row' : 'file-row'}">
              <i data-lucide="${iconName}" class="w-4 h-4 ${iconColor} shrink-0"></i>
              <span class="truncate">${escapeHtml(e.name)}</span>
            </div>
          </td>
          <td class="py-2 pr-3 hidden sm:table-cell text-slate-400">${e.type === 'file' ? fmtBytes(e.size) : '—'}</td>
          <td class="py-2 pr-3 hidden md:table-cell text-slate-400 text-xs">${e.modified ? new Date(e.modified).toLocaleString() : '—'}</td>
          <td class="py-2 text-right whitespace-nowrap">
            ${e.type === 'file' ? `
              <button class="btn-icon" data-op="edit" title="Edit"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button>
            ` : ''}
            <button class="btn-icon" data-op="rename" title="Rename"><i data-lucide="text-cursor-input" class="w-3.5 h-3.5"></i></button>
            <button class="btn-icon" data-op="download" title="Download"><i data-lucide="download" class="w-3.5 h-3.5"></i></button>
            <button class="btn-icon text-red-400" data-op="delete" title="Delete"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
          </td>
        </tr>`);
    });

    $('#file-list').innerHTML = rows.join('') || '<tr><td colspan="4" class="py-6 text-center text-slate-500 text-sm">Empty directory</td></tr>';
    lucide.createIcons();
    attachFileHandlers();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function iconForFile(name) {
  const ext = name.split('.').pop().toLowerCase();
  if (['html', 'htm'].includes(ext)) return 'file-code';
  if (['js', 'mjs', 'cjs'].includes(ext)) return 'file-code-2';
  if (['json', 'yml', 'yaml'].includes(ext)) return 'file-json';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  if (['zip', 'tar', 'gz', 'rar'].includes(ext)) return 'file-archive';
  if (['md', 'txt'].includes(ext)) return 'file-text';
  if (['sh', 'bash'].includes(ext)) return 'terminal';
  return 'file';
}

function attachFileHandlers() {
  $$('#file-list tr').forEach((tr) => {
    // Navigate
    tr.querySelector('.folder-row')?.addEventListener('click', () => loadFiles(tr.dataset.path));
    tr.querySelector('.file-row')?.addEventListener('click', () => openInEditor(tr.dataset.path));

    tr.querySelector('[data-action="up"]')?.addEventListener('click', () => {
      const parts = currentPath.split('/').filter(Boolean);
      parts.pop();
      loadFiles(parts.join('/'));
    });

    // Actions
    tr.querySelectorAll('[data-op]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const op = btn.dataset.op;
        const path = tr.dataset.path;
        const name = tr.dataset.name;
        const isDir = tr.dataset.type === 'directory';

        if (op === 'edit') return openInEditor(path);
        if (op === 'download') return window.open(`/api/download?path=${encodeURIComponent(path)}`);
        if (op === 'rename') return promptRename(path, name);
        if (op === 'delete') return promptDelete(path, name, isDir);
      });
    });
  });
}

async function promptRename(oldPath, currentName) {
  const newName = await showModal({
    title: 'Rename',
    message: 'Enter new name:',
    input: currentName,
    confirmText: 'Rename'
  });
  if (!newName || newName === currentName) return;

  const parent = currentPath ? currentPath + '/' : '';
  const newPath = parent + newName.replace(/[\\/]/g, '');

  try {
    await api('/rename', { method: 'POST', body: { oldPath, newPath } });
    toast('Renamed', 'success');
    loadFiles(currentPath);
  } catch (err) { toast(err.message, 'error'); }
}

async function promptDelete(path, name, isDir) {
  const ok = await showModal({
    title: 'Delete ' + (isDir ? 'Folder' : 'File'),
    message: `Are you sure you want to delete "${name}"? This cannot be undone.`,
    confirmText: 'Delete',
    danger: true
  });
  if (!ok) return;

  try {
    await api(`/delete?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
    toast('Deleted', 'success');
    loadFiles(currentPath);
  } catch (err) { toast(err.message, 'error'); }
}

/* ────────── Upload ────────── */
async function uploadFiles(files) {
  if (!files || !files.length) return;
  const fd = new FormData();
  fd.append('targetPath', currentPath);
  [...files].forEach((f) => fd.append('files', f));

  try {
    toast(`Uploading ${files.length} file(s)...`, 'info');
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Upload failed');
    toast(`Uploaded ${data.files.length} file(s)`, 'success');
    loadFiles(currentPath);
  } catch (err) { toast(err.message, 'error'); }
}

/* ────────── Modal ────────── */
function showModal({ title, message, input = null, confirmText = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const modal = $('#modal');
    $('#modal-title').textContent = title;
    $('#modal-message').textContent = message;
    const inputEl = $('#modal-input');
    const confirmBtn = $('#modal-confirm');

    if (input !== null) {
      inputEl.value = input;
      inputEl.classList.remove('hidden');
    } else {
      inputEl.classList.add('hidden');
    }

    confirmBtn.textContent = confirmText;
    confirmBtn.className = danger ? 'btn-danger' : 'btn-primary';

    modal.classList.remove('hidden');
    modal.classList.add('flex');

    const close = (val) => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
      confirmBtn.removeEventListener('click', onConfirm);
      $('#modal-cancel').removeEventListener('click', onCancel);
      inputEl.removeEventListener('keydown', onKey);
      resolve(val);
    };

    const onConfirm = () => close(input !== null ? inputEl.value.trim() : true);
    const onCancel  = () => close(input !== null ? null : false);
    const onKey     = (e) => { if (e.key === 'Enter') onConfirm(); };

    confirmBtn.addEventListener('click', onConfirm);
    $('#modal-cancel').addEventListener('click', onCancel);
    inputEl.addEventListener('keydown', onKey);

    if (input !== null) setTimeout(() => inputEl.focus(), 100);
  });
}

/* ────────── GitHub ────────── */
async function loadDeployedSites() {
  try {
    const { sites } = await api('/sites');

    // Populate pull dropdown
    $('#git-pull-site').innerHTML = sites.length
      ? sites.map((s) => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join('')
      : '<option value="">No sites</option>';

    // Deployed grid
    $('#deployed-sites').innerHTML = sites.length
      ? sites.map((s) => `
          <div class="glass-card">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="font-medium truncate">${escapeHtml(s.name)}</div>
                <div class="text-[11px] text-slate-400 truncate">${escapeHtml(s.relative)}</div>
              </div>
              <i data-lucide="server" class="w-4 h-4 text-indigo-400 shrink-0"></i>
            </div>
            <div class="mt-3 flex flex-wrap gap-1.5 text-[10px]">
              ${s.hasIndex   ? '<span class="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">index</span>' : ''}
              ${s.hasPackage ? '<span class="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300">node</span>'    : ''}
            </div>
            <a href="/site/${encodeURIComponent(s.name)}/" target="_blank" class="btn-secondary w-full mt-3 text-xs">
              <i data-lucide="external-link" class="w-3 h-3"></i> Open
            </a>
          </div>`).join('')
      : '<p class="text-xs text-slate-500 col-span-full">No sites yet.</p>';

    lucide.createIcons();
  } catch (err) { toast(err.message, 'error'); }
}

async function gitClone() {
  const repoUrl = $('#git-url').value.trim();
  const branch  = $('#git-branch').value.trim() || 'main';
  const siteName = $('#git-name').value.trim();
  const token   = $('#git-token').value.trim();

  if (!repoUrl) return toast('Repository URL required', 'error');

  const btn = $('#btn-git-clone');
  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Cloning...';
  lucide.createIcons();

  try {
    const data = await api('/git/clone', {
      method: 'POST',
      body: { repoUrl, branch, siteName, token }
    });
    toast(data.message, 'success');
    $('#git-url').value = '';
    $('#git-name').value = '';
    $('#git-token').value = '';
    loadDeployedSites();
  } catch (err) { toast(err.message, 'error'); }

  btn.disabled = false;
  btn.innerHTML = '<i data-lucide="download-cloud" class="w-4 h-4"></i> Clone / Deploy';
  lucide.createIcons();
}

async function gitPull() {
  const siteName = $('#git-pull-site').value;
  const token = $('#git-pull-token').value.trim();
  if (!siteName) return toast('Select a site', 'error');

  const btn = $('#btn-git-pull');
  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Pulling...';
  lucide.createIcons();

  try {
    const data = await api('/git/pull', { method: 'POST', body: { siteName, token } });
    toast(`${data.message} (${data.changes} file change(s))`, 'success');
  } catch (err) { toast(err.message, 'error'); }

  btn.disabled = false;
  btn.innerHTML = '<i data-lucide="refresh-cw" class="w-4 h-4"></i> Pull Latest';
  lucide.createIcons();
}

/* ────────── Tunnel ────────── */
async function refreshTunnelStatus() {
  try {
    const data = await api('/tunnel/status');
    if (data.quick?.running && data.quick.url) {
      $('#quick-result').classList.remove('hidden');
      $('#quick-url').value = data.quick.url;
    }
    loadTunnelLogs();
  } catch (_) {}
}

async function startQuickTunnel() {
  const port = parseInt($('#quick-port').value, 10) || 3000;
  const btn = $('#btn-quick-start');
  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Starting...';
  lucide.createIcons();

  try {
    const data = await api('/tunnel/quick/start', { method: 'POST', body: { port } });
    $('#quick-result').classList.remove('hidden');
    $('#quick-url').value = data.url;
    toast('Quick tunnel active', 'success');
    loadTunnelLogs();
  } catch (err) { toast(err.message, 'error'); }

  btn.disabled = false;
  btn.innerHTML = '<i data-lucide="play" class="w-4 h-4"></i> Start';
  lucide.createIcons();
}

async function stopQuickTunnel() {
  try {
    await api('/tunnel/quick/stop', { method: 'POST', body: {} });
    $('#quick-result').classList.add('hidden');
    $('#quick-url').value = '';
    toast('Quick tunnel stopped', 'info');
    loadTunnelLogs();
  } catch (err) { toast(err.message, 'error'); }
}

async function startNamedTunnel() {
  const tunnelName = $('#named-name').value.trim();
  if (!tunnelName) return toast('Tunnel name required', 'error');

  const btn = $('#btn-named-start');
  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Starting...';
  lucide.createIcons();

  try {
    const data = await api('/tunnel/named/start', { method: 'POST', body: { tunnelName } });
    toast(data.message, 'success');
    loadTunnelLogs();
  } catch (err) { toast(err.message, 'error'); }

  btn.disabled = false;
  btn.innerHTML = '<i data-lucide="play" class="w-4 h-4"></i> Start';
  lucide.createIcons();
}

async function stopNamedTunnel() {
  try {
    await api('/tunnel/named/stop', { method: 'POST', body: {} });
    toast('Named tunnel stopped', 'info');
    loadTunnelLogs();
  } catch (err) { toast(err.message, 'error'); }
}

async function listNamedTunnels() {
  try {
    const { tunnels } = await api('/tunnel/named/list');
    $('#named-list').innerHTML = tunnels.length
      ? tunnels.map((t) => `
          <div class="flex items-center justify-between p-2 rounded-lg bg-white/5">
            <div>
              <div class="font-mono text-xs">${escapeHtml(t.name || t.id)}</div>
              <div class="text-[10px] text-slate-500">${escapeHtml(t.id)}</div>
            </div>
          </div>`).join('')
      : '<p class="text-slate-500">No named tunnels.</p>';
  } catch (err) { toast(err.message, 'error'); }
}

async function loadTunnelLogs() {
  try {
    const { content } = await api('/tunnel/logs?file=tunnel-quick.log');
    $('#tunnel-logs').textContent = content || '(empty)';
    $('#tunnel-logs').scrollTop = $('#tunnel-logs').scrollHeight;
  } catch (_) {}
}

/* ────────── App Logs ────────── */
async function loadAppLogs() {
  try {
    const res = await fetch('/panel/../logs/server.log').catch(() => null);
    // Fallback: read tunnel log via API
    const { content } = await api('/tunnel/logs?file=tunnel-quick.log');
    $('#app-logs').textContent =
      `Last refreshed: ${new Date().toLocaleString()}\n\n` +
      `── Quick Tunnel Log ──\n${content}\n`;
  } catch (err) {
    $('#app-logs').textContent = `Unable to load log: ${err.message}`;
  }
}

/* ────────── Init ────────── */
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();

  // Sidebar nav
  $$('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => showView(btn.dataset.view));
  });

  // Mobile menu
  $('#menu-btn').addEventListener('click', () => {
    $('#sidebar').classList.toggle('-translate-x-full');
    $('#overlay').classList.toggle('hidden');
  });
  $('#overlay').addEventListener('click', () => {
    $('#sidebar').classList.add('-translate-x-full');
    $('#overlay').classList.add('hidden');
  });

  // Refresh
  $('#refresh-btn').addEventListener('click', () => {
    const active = $('.nav-btn.active')?.dataset.view || 'dashboard';
    showView(active);
  });

  // File manager actions
  $('#btn-new-file').addEventListener('click', async () => {
    const name = await showModal({ title: 'New File', message: 'File name:', input: 'index.html', confirmText: 'Create' });
    if (!name) return;
    try {
      await api('/create', { method: 'POST', body: { path: (currentPath ? currentPath + '/' : '') + name, type: 'file' } });
      toast('File created', 'success');
      loadFiles(currentPath);
    } catch (err) { toast(err.message, 'error'); }
  });

  $('#btn-new-folder').addEventListener('click', async () => {
    const name = await showModal({ title: 'New Folder', message: 'Folder name:', input: 'new-folder', confirmText: 'Create' });
    if (!name) return;
    try {
      await api('/create', { method: 'POST', body: { path: (currentPath ? currentPath + '/' : '') + name, type: 'directory' } });
      toast('Folder created', 'success');
      loadFiles(currentPath);
    } catch (err) { toast(err.message, 'error'); }
  });

  $('#btn-upload').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', (e) => {
    uploadFiles(e.target.files);
    e.target.value = '';
  });

  // Drag & drop
  const dz = $('#drop-zone');
  ['dragenter', 'dragover'].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('dragover'); })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('dragover'); })
  );
  dz.addEventListener('drop', (e) => uploadFiles(e.dataTransfer.files));

  // Git buttons
  $('#btn-git-clone').addEventListener('click', gitClone);
  $('#btn-git-pull').addEventListener('click', gitPull);

  // Tunnel buttons
  $('#btn-quick-start').addEventListener('click', startQuickTunnel);
  $('#btn-quick-stop').addEventListener('click', stopQuickTunnel);
  $('#btn-named-start').addEventListener('click', startNamedTunnel);
  $('#btn-named-stop').addEventListener('click', stopNamedTunnel);
  $('#btn-named-list').addEventListener('click', listNamedTunnels);
  $('#btn-refresh-logs').addEventListener('click', loadTunnelLogs);
  $('#btn-copy-url').addEventListener('click', () => {
    const url = $('#quick-url').value;
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => toast('URL copied', 'success'));
  });

  // Clock
  setInterval(() => {
    $('#clock').textContent = new Date().toLocaleTimeString();
  }, 1000);

  // Auto-refresh dashboard every 5s when active
  setInterval(() => {
    if ($('.nav-btn.active')?.dataset.view === 'dashboard') loadDashboard();
  }, 5000);

  // Boot
  showView('dashboard');
});
