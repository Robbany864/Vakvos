/**
 * Termux CPanel - Main Server
 * Express-based control panel for Android Termux with Cloudflare Tunnel support
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const bodyParser = require('body-parser');

const apiRouter = require('./routes/api');
const gitRouter = require('./routes/git');
const tunnelRouter = require('./routes/tunnel');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure core directories exist
const WWW_ROOT = path.join(__dirname, 'www');
const PUBLIC_ROOT = path.join(__dirname, 'public');
const LOGS_DIR = path.join(__dirname, 'logs');

[WWW_ROOT, PUBLIC_ROOT, LOGS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Static control panel assets
app.use('/panel', express.static(PUBLIC_ROOT));
app.use('/panel/css', express.static(path.join(PUBLIC_ROOT, 'css')));
app.use('/panel/js', express.static(path.join(PUBLIC_ROOT, 'js')));

// Redirect root → panel
app.get('/', (req, res) => res.redirect('/panel/index.html'));

// API Routers
app.use('/api', apiRouter);
app.use('/api/git', gitRouter);
app.use('/api/tunnel', tunnelRouter);

// Dynamic hosted site serving: /site/<sitename>/*
app.use('/site/:siteName', (req, res, next) => {
  const siteName = req.params.siteName.replace(/[^a-zA-Z0-9_\-]/g, '');
  const sitePath = path.join(WWW_ROOT, siteName);

  if (!fs.existsSync(sitePath) || !fs.statSync(sitePath).isDirectory()) {
    return res.status(404).send('Site not found');
  }

  express.static(sitePath)(req, res, next);
});

// Health probe
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    port: PORT
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal Server Error'
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log('══════════════════════════════════════════════');
  console.log('  🚀 Termux CPanel Running');
  console.log('══════════════════════════════════════════════');
  console.log(`  Panel URL  : http://localhost:${PORT}/panel`);
  console.log(`  API Base   : http://localhost:${PORT}/api`);
  console.log(`  WWW Root   : ${WWW_ROOT}`);
  console.log(`  Started at : ${new Date().toLocaleString()}`);
  console.log('══════════════════════════════════════════════');
});

module.exports = app;
