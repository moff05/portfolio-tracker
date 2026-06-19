import { app, BrowserWindow, utilityProcess } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

app.whenReady().then(async () => {
  try {
    await startServer();
    createWindow();
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
