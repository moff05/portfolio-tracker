import { app, BrowserWindow, utilityProcess, Notification } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import updaterPkg from 'electron-updater';
const { autoUpdater } = updaterPkg;

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const isDev = !app.isPackaged;
const PORT = 3847;

// Keep userData path stable regardless of productName — prevents DB loss on renames
if (app.isPackaged) {
  app.setPath('userData', join(app.getPath('appData'), 'Portfolio Tracker'));
}

let mainWindow = null;
let serverProc = null;

function getDistPath() {
  return isDev
    ? join(__dirname, '..', 'dist')
    : join(process.resourcesPath, 'app.asar.unpacked', 'dist');
}

function getServerScript() {
  return isDev
    ? join(__dirname, 'server.mjs')
    : join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'server.mjs');
}

function getDbPath() {
  return isDev
    ? join(__dirname, '..', 'data', 'portfolio.db')
    : join(app.getPath('userData'), 'portfolio.db');
}

function startServer() {
  return new Promise((resolve, reject) => {
    serverProc = utilityProcess.fork(getServerScript(), [], {
      stdio: 'pipe',
      env: {
        ...process.env,
        PORT: String(PORT),
        DIST_PATH: getDistPath(),
        DB_PATH: getDbPath(),
        USER_DATA_PATH: app.getPath('userData'),
      },
    });

    serverProc.stdout?.on('data', (d) => process.stdout.write('[srv] ' + d));
    serverProc.stderr?.on('data', (d) => process.stderr.write('[srv] ' + d));

    const timeout = setTimeout(
      () => reject(new Error('Server did not signal ready within 15s')),
      15000,
    );

    serverProc.on('message', (msg) => {
      if (msg?.type === 'ready') {
        clearTimeout(timeout);
        resolve();
      }
    });

    serverProc.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server process exited prematurely (code ${code})`));
    });
  });
}

function createSplashWindow() {
  const splash = new BrowserWindow({
    width: 380,
    height: 260,
    frame: false,
    resizable: false,
    center: true,
    skipTaskbar: true,
    backgroundColor: '#09090b',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  splash.loadFile(join(__dirname, 'splash.html'));
  return splash;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    autoHideMenuBar: true,
    title: 'Portfolio Manager',
    show: false,
    backgroundColor: '#09090b',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body }).show();
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (err) => {
    console.error('[updater] error:', err.message);
  });

  autoUpdater.on('update-available', (info) => {
    notify('Update downloading…', `v${info.version} will install automatically when you close the app.`);
  });

  autoUpdater.on('download-progress', (p) => {
    if (mainWindow) mainWindow.setProgressBar(p.percent / 100);
  });

  autoUpdater.on('update-downloaded', () => {
    if (mainWindow) mainWindow.setProgressBar(-1);
    notify('Update installing…', 'Portfolio Manager is restarting to apply the update.');
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 4000);
  });

  autoUpdater.checkForUpdates();
  setInterval(() => autoUpdater.checkForUpdates(), 60 * 60 * 1000);
}

app.whenReady().then(async () => {
  const splash = createSplashWindow();
  createWindow();

  // Start updater immediately — before page load — so a broken page can't
  // prevent the auto-updater from finding and downloading a fix.
  if (!isDev) setupAutoUpdater();

  try {
    await startServer();
    mainWindow.loadURL(`http://127.0.0.1:${PORT}/dashboard`);
    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
      splash.destroy();
    });
    // If the page fails to load, still show the window so the user isn't
    // stuck on the splash screen with no way to close the app.
    mainWindow.webContents.on('did-fail-load', () => {
      splash.destroy();
      mainWindow.show();
    });
  } catch (err) {
    console.error('[main] Failed to start server:', err);
    splash.destroy();
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (e) => {
  if (!serverProc) return;
  e.preventDefault();
  serverProc.on('exit', () => {
    serverProc = null;
    app.quit();
  });
  serverProc.kill();
});
