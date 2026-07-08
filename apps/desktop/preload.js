const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopApp", {
  getConfig: () => ipcRenderer.invoke("desktop:get-config"),
  saveConfig: (payload) => ipcRenderer.invoke("desktop:save-config", payload),
  reloadChat: () => ipcRenderer.invoke("desktop:reload-chat"),
  showServerExample: () => ipcRenderer.invoke("desktop:show-server-example"),
});
