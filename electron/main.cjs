const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, Menu, protocol, screen, shell } = require('electron');

const APP_SCHEME = 'app';
const APP_HOST = 'antwordprofiler';
const DIST_ROOT = path.resolve(__dirname, '..', 'dist');
const DEFAULT_ZOOM_FACTOR = 0.8;

/** @type {BrowserWindow | null} */
let mainWindow = null;

// Single-instance lock so double-clicking the .exe focuses the running window
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  });
}

// Register app:// as a privileged secure origin before app.whenReady()
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.lst': 'text/plain; charset=utf-8',
  '.tsv': 'text/plain; charset=utf-8',
  '.csv': 'text/plain; charset=utf-8',
  '.ini': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
};

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function isExternalHttpUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const devUrl = process.env.ELECTRON_DEV_URL;
    if (devUrl && rawUrl.startsWith(devUrl)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function registerAppProtocol() {
  protocol.handle(APP_SCHEME, async (request) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(request.url);
    } catch {
      return new Response('Bad Request', { status: 400 });
    }

    let decodedPath;
    try {
      decodedPath = decodeURIComponent(parsedUrl.pathname || '/');
    } catch {
      return new Response('Bad Request', { status: 400 });
    }

    if (decodedPath === '/' || decodedPath === '') {
      decodedPath = '/index.html';
    }

    const relativeSubpath = decodedPath.replace(/^\/+/, '');
    const filePath = path.resolve(DIST_ROOT, relativeSubpath);

    // Path-traversal check (safe across Windows drive-letter casing)
    const rel = path.relative(DIST_ROOT, filePath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      const data = await fs.promises.readFile(filePath);
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': getMimeType(filePath),
          'Cache-Control': 'no-cache',
        },
      });
    } catch (err) {
      if (err && (err.code === 'ENOENT' || err.code === 'EISDIR')) {
        return new Response('Not Found', { status: 404 });
      }
      return new Response('Internal Server Error', { status: 500 });
    }
  });
}

function createMainWindow() {
  Menu.setApplicationMenu(null);

  const { workAreaSize } = screen.getPrimaryDisplay();
  const initialWidth = Math.min(1600, Math.round(workAreaSize.width * 0.96));
  const initialHeight = Math.min(960, Math.round(workAreaSize.height * 0.94));
  let currentZoomFactor = DEFAULT_ZOOM_FACTOR;

  const win = new BrowserWindow({
    title: 'AntWordProfiler',
    width: initialWidth,
    height: initialHeight,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f8fafc',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      zoomFactor: DEFAULT_ZOOM_FACTOR,
    },
  });

  mainWindow = win;

  const applyZoom = () => {
    if (!win.isDestroyed()) {
      win.webContents.setZoomFactor(currentZoomFactor);
    }
  };

  win.webContents.on('dom-ready', applyZoom);
  win.webContents.on('did-finish-load', applyZoom);

  win.once('ready-to-show', () => {
    applyZoom();
    win.maximize();
    win.show();
  });

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  // Open external links (e.g., Google AI Studio, OpenRouter docs) in default OS browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttpUrl(url)) {
      void shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (isExternalHttpUrl(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  // Keyboard shortcuts for zoom (Ctrl+/-/0), fullscreen (F11), and DevTools diagnostics (F12 / Ctrl+Shift+I)
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;

    if ((input.control || input.meta) && !input.alt) {
      if (input.key === '=' || input.key === '+' || input.code === 'NumpadAdd') {
        event.preventDefault();
        currentZoomFactor = Math.min(1.5, Math.round((currentZoomFactor + 0.05) * 100) / 100);
        applyZoom();
        return;
      }
      if (input.key === '-' || input.key === '_' || input.code === 'NumpadSubtract') {
        event.preventDefault();
        currentZoomFactor = Math.max(0.6, Math.round((currentZoomFactor - 0.05) * 100) / 100);
        applyZoom();
        return;
      }
      if ((input.key === '0' || input.code === 'Digit0' || input.code === 'Numpad0') && !input.shift) {
        event.preventDefault();
        currentZoomFactor = DEFAULT_ZOOM_FACTOR;
        applyZoom();
        return;
      }
    }

    if (input.key === 'F11') {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
      return;
    }
    const isCtrlShiftI =
      (input.control || input.meta) &&
      input.shift &&
      input.key.toLowerCase() === 'i';
    if (input.key === 'F12' || isCtrlShiftI) {
      event.preventDefault();
      win.webContents.toggleDevTools();
    }
  });

  const startUrl =
    process.env.ELECTRON_DEV_URL || `${APP_SCHEME}://${APP_HOST}/index.html`;
  void win.loadURL(startUrl);
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  registerAppProtocol();
  createMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
