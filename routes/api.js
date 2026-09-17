/**
 * File Manager API — secure CRUD operations inside /www
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const archiver = require('archiver');
const si = require('systeminformation');

const router = express.Router();

const WWW_ROOT = path.resolve(path.join(__dirname, '..', 'www'));

// Ensure root exists
if (!fs.existsSync(WWW_ROOT)) fs.mkdirSync(WWW_ROOT, { recursive: true });

/**
 * Sanitize & resolve a user-supplied path strictly within WWW_ROOT.
 * Blocks any traversal attempt.
 */
function safePath(relativePath = '') {
  const normalized = path.normalize(relativePath).replace(/^(\.\.[\/\\])+/, '');
  const resolved = path.resolve(WWW_ROOT, normalized);
  const relative = path.relative(WWW_ROOT, resolved);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path traversal detected — access denied');
  }
  return resolved;
}

/**
 * Return relative POSIX-style path from WWW_ROOT.
 */
function toRelative(absPath) {
  return path.relative(WWW_ROOT, absPath).split(path.sep).join('/');
}

/* ─────────────── Multer (upload) ─────────────── */
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        const dest = safePath(req.body.targetPath || '');
        if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
        cb(null, dest);
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => {
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._\-]/g, '_');
      cb(null, safeName);
    }
  }),
  limits: { fileSize: 500 * 1024 * 1024 } // 500 MB
});

/* ─────────────── System Health ─────────────── */
router.get('/system', async (req, res) => {
  try {
    const [load, mem, fsSize, osInfo, time] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.osInfo(),
      si.time()
    ]);

    const rootFs = fsSize.find((f) => f.mount === '/' || f.mount === '/data') || fsSize[0];

    res.json({
      success: true,
      cpu: {
        usage: Number(load.currentLoad.toFixed(2)),
        cores: load.cpus?.length || 1
      },
      memory: {
        total: mem.total,
        used: mem.active,
        free: mem.available,
        usagePercent: Number(((mem.active / mem.total) * 100).toFixed(2))
      },
      storage: rootFs
        ? {
            total: rootFs.size,
            used: rootFs.used,
            free: rootFs.available,
            usagePercent: Number(rootFs.use.toFixed(2)),
            mount: rootFs.mount
          }
        : null,
      os: {
        platform: osInfo.platform,
        distro: osInfo.distro,
        release: osInfo.release,
        hostname: osInfo.hostname,
        arch: osInfo.arch
      },
      node: {
        version: process.version,
        uptime: time.uptime,
        pid: process.pid,
        memoryUsage: process.memoryUsage()
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ─────────────── List Directory ─────────────── */
router.get('/files', (req, res) => {
  try {
    const target = safePath(req.query.path || '');
    if (!fs.existsSync(target)) {
      return res.status(404).json({ success: false, error: 'Directory not found' });
    }
    if (!fs.statSync(target).isDirectory()) {
      return res.status(400).json({ success: false, error: 'Not a directory' });
    }

    const entries = fs.readdirSync(target, { withFileTypes: true }).map((e) => {
      const fullPath = path.join(target, e.name);
      let stats = null;
      try { stats = fs.statSync(fullPath); } catch (_) {}

      return {
        name: e.name,
        type: e.isDirectory() ? 'directory' : 'file',
        size: stats ? stats.size : 0,
        modified: stats ? stats.mtime.toISOString() : null,
        path: toRelative(fullPath)
      };
    });

    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    res.json({
      success: true,
      path: toRelative(target),
      parent: toRelative(path.dirname(target)) || '',
      entries
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/* ─────────────── Read File ─────────────── */
router.get('/file', (req, res) => {
  try {
    const target = safePath(req.query.path || '');
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }

    const stats = fs.statSync(target);
    const MAX_EDIT = 5 * 1024 * 1024; // 5 MB

    if (stats.size > MAX_EDIT) {
      return res.status(413).json({
        success: false,
        error: 'File too large to edit (>5MB). Use download instead.'
      });
    }

    const content = fs.readFileSync(target, 'utf8');
    res.json({
      success: true,
      path: toRelative(target),
      size: stats.size,
      modified: stats.mtime.toISOString(),
      content
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/* ─────────────── Save File ─────────────── */
router.put('/file', (req, res) => {
  try {
    const { path: relPath, content } = req.body;
    if (typeof relPath !== 'string' || typeof content !== 'string') {
      return res.status(400).json({ success: false, error: 'Invalid payload' });
    }

    const target = safePath(relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');

    res.json({ success: true, path: toRelative(target), savedAt: new Date().toISOString() });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/* ─────────────── Create File / Folder ─────────────── */
router.post('/create', (req, res) => {
  try {
    const { path: relPath, type } = req.body;
    if (!relPath || !['file', 'directory'].includes(type)) {
      return res.status(400).json({ success: false, error: 'Invalid payload' });
    }

    const target = safePath(relPath);
    if (fs.existsSync(target)) {
      return res.status(409).json({ success: false, error: 'Already exists' });
    }

    if (type === 'directory') {
      fs.mkdirSync(target, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, '', 'utf8');
    }

    res.json({ success: true, path: toRelative(target) });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/* ─────────────── Rename ─────────────── */
router.post('/rename', (req, res) => {
  try {
    const { oldPath, newPath } = req.body;
    if (!oldPath || !newPath) {
      return res.status(400).json({ success: false, error: 'Missing paths' });
    }

    const src = safePath(oldPath);
    const dst = safePath(newPath);

    if (!fs.existsSync(src)) {
      return res.status(404).json({ success: false, error: 'Source not found' });
    }
    if (fs.existsSync(dst)) {
      return res.status(409).json({ success: false, error: 'Destination exists' });
    }

    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);

    res.json({ success: true, from: toRelative(src), to: toRelative(dst) });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/* ─────────────── Delete ─────────────── */
router.delete('/delete', (req, res) => {
  try {
    const relPath = req.query.path;
    if (!relPath) {
      return res.status(400).json({ success: false, error: 'Missing path' });
    }

    const target = safePath(relPath);
    if (target === WWW_ROOT) {
      return res.status(403).json({ success: false, error: 'Cannot delete WWW root' });
    }
    if (!fs.existsSync(target)) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }

    fs.rmSync(target, { recursive: true, force: true });
    res.json({ success: true, deleted: toRelative(target) });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/* ─────────────── Upload ─────────────── */
router.post('/upload', upload.array('files', 20), (req, res) => {
  try {
    const uploaded = (req.files || []).map((f) => ({
      name: f.filename,
      size: f.size,
      path: path.relative(WWW_ROOT, f.path).split(path.sep).join('/')
    }));
    res.json({ success: true, files: uploaded });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/* ─────────────── Download (zip a folder or single file) ─────────────── */
router.get('/download', (req, res) => {
  try {
    const target = safePath(req.query.path || '');
    if (!fs.existsSync(target)) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }

    const stats = fs.statSync(target);
    const baseName = path.basename(target);

    if (stats.isFile()) {
      return res.download(target, baseName);
    }

    // Folder → stream ZIP
    res.attachment(`${baseName}.zip`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => res.status(500).end(err.message));
    archive.pipe(res);
    archive.directory(target, false);
    archive.finalize();
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/* ─────────────── List hosted sites ─────────────── */
router.get('/sites', (req, res) => {
  try {
    const entries = fs.readdirSync(WWW_ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => {
        const full = path.join(WWW_ROOT, e.name);
        const stats = fs.statSync(full);
        const hasIndex = ['index.html', 'index.htm', 'index.php'].some((f) =>
          fs.existsSync(path.join(full, f))
        );
        const hasPackage = fs.existsSync(path.join(full, 'package.json'));
        return {
          name: e.name,
          path: full,
          relative: e.name,
          modified: stats.mtime.toISOString(),
          hasIndex,
          hasPackage
        };
      });
    res.json({ success: true, sites: entries });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
