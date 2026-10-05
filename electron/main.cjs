const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const path = require('path');

const isDev = process.argv.includes('--dev');
const DEV_URL = 'http://localhost:5173';

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    backgroundColor: '#0f141e',
    title: 'PolyValor',
    icon: path.join(__dirname, 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });

  // Open external links in the system browser instead of inside the game window
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // F11 toggles fullscreen, F12 toggles devtools
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    } else if (input.key === 'F12') {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  if (isDev) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

// No application menu: keeps Ctrl+W / Ctrl+R etc. from closing or reloading the game mid-match
Menu.setApplicationMenu(null);

ipcMain.on('app:quit', () => app.quit());
ipcMain.on('app:set-fullscreen', (e, on) => {
  BrowserWindow.fromWebContents(e.sender)?.setFullScreen(!!on);
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
