const { contextBridge, ipcRenderer } = require('electron');

// Minimal, explicit bridge for the game UI
contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  quit: () => ipcRenderer.send('app:quit'),
  setFullscreen: (on) => ipcRenderer.send('app:set-fullscreen', !!on),
});
