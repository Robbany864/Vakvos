/**
 * GitHub Integration — clone & pull repositories into /www
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const simpleGit = require('simple-git');

const router = express.Router();
const WWW_ROOT = path.resolve(path.join(__dirname, '..', 'www'));

function sanitizeRepoName(url) {
  const name = url
    .replace(/\.git$/, '')
    .split('/')
    .pop()
    .replace(/[^a-zA-Z0-9._\-]/g, '_');
  return name || `repo_${Date.now()}`;
}

function injectToken(url, token) {
  if (!token) return url;
  try {
    const u = new URL(url);
    u.username = token;
    u.password = 'x-oauth-basic';
    return u.toString();
  } catch {
    // SSH or other format — return as-is
    return url;
  }
}

/* ─────────────── Clone ─────────────── */
router.post('/clone', async (req, res) => {
  try {
    const { repoUrl, branch = 'main', token = '', siteName = '' } = req.body;

    if (!repoUrl || !/^https?:\/\/|^git@/.test(repoUrl)) {
      return res.status(400).json({ success: false, error: 'Invalid repository URL' });
    }

    const name = siteName ? siteName.replace(/[^a-zA-Z0-9._\-]/g, '_') : sanitizeRepoName(repoUrl);
    const targetDir = path.join(WWW_ROOT, name);

    if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
      return res.status(409).json({
        success: false,
        error: `Directory '${name}' already exists and is not empty`
      });
    }

    fs.mkdirSync(targetDir, { recursive: true });

    const cloneUrl = injectToken(repoUrl, token);
    const git = simpleGit({ baseDir: WWW_ROOT });

    await git.clone(cloneUrl, name, ['--branch', branch, '--depth', '1']);

    res.json({
      success: true,
      site: name,
      path: targetDir,
      branch,
      message: `Cloned '${name}' successfully from branch '${branch}'`
    });
  } catch (err) {
    console.error('[GIT CLONE]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ─────────────── Pull ─────────────── */
router.post('/pull', async (req, res) => {
  try {
    const { siteName, token = '' } = req.body;
    if (!siteName) {
      return res.status(400).json({ success: false, error: 'siteName required' });
    }

    const safeName = siteName.replace(/[^a-zA-Z0-9._\-]/g, '_');
    const targetDir = path.join(WWW_ROOT, safeName);

    if (!fs.existsSync(path.join(targetDir, '.git'))) {
      return res.status(400).json({ success: false, error: 'Not a git repository' });
    }

    const git = simpleGit({ baseDir: targetDir });

    if (token) {
      const remotes = await git.getRemotes(true);
      const origin = remotes.find((r) => r.name === 'origin');
      if (origin && origin.refs?.fetch) {
        const authed = injectToken(origin.refs.fetch, token);
        await git.remote(['set-url', 'origin', authed]);
      }
    }

    const result = await git.pull();

    res.json({
      success: true,
      site: safeName,
      summary: result.summary,
      changes: result.files?.length || 0,
      message: `Pulled latest changes for '${safeName}'`
    });
  } catch (err) {
    console.error('[GIT PULL]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ─────────────── Status ─────────────── */
router.get('/status/:siteName', async (req, res) => {
  try {
    const safeName = req.params.siteName.replace(/[^a-zA-Z0-9._\-]/g, '_');
    const targetDir = path.join(WWW_ROOT, safeName);
    if (!fs.existsSync(path.join(targetDir, '.git'))) {
      return res.status(404).json({ success: false, error: 'Not a git repository' });
    }

    const git = simpleGit({ baseDir: targetDir });
    const status = await git.status();
    const log = await git.log({ maxCount: 5 });

    res.json({ success: true, status, recentCommits: log.all });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
