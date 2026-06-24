import { app, BrowserWindow, utilityProcess, Notification } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import updaterPkg from 'electron-updater';
const { autoUpdater } = updaterPkg;

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const isDev = !app.isPackaged;
const PORT = 3847;

let mainWindow = null;
let serverProc = null;

function getDistPath() {
  return isDev
    ? join(__dirname, '..', 'dist')
    : join(process.resourcesPath, 'app', 'dist');
}

function getServerScript() {
  return isDev
    ? join(__dirname, 'server.mjs')
    : join(process.resourcesPath, 'app', 'electron', 'server.mjs');
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    autoHideMenuBar: true,
    title: 'Portfolio Tracker',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}/dashboard`);
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
    notify('Update ready', 'Close and reopen Portfolio Tracker to finish installing.');
  });

  autoUpdater.checkForUpdatesAndNotify();
}

app.whenReady().then(async () => {
  try {
    await startServer();
    createWindow();
    if (!isDev) setupAutoUpdater();
  } catch (err) {
    console.error('[main] Failed to start server:', err);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (serverProc) serverProc.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProc) serverProc.kill();
});
