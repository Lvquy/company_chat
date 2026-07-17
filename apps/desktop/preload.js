const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopApp", {
  getConfig: () => ipcRenderer.invoke("desktop:get-config"),
  saveConfig: (payload) => ipcRenderer.invoke("desktop:save-config", payload),
  reloadChat: () => ipcRenderer.invoke("desktop:reload-chat"),
  notify: (payload) => ipcRenderer.invoke("desktop:notify", payload),
  requestMediaAccess: (kind) => ipcRenderer.invoke("desktop:request-media-access", kind),
  setBadgeCount: (count) => ipcRenderer.invoke("desktop:set-badge-count", count),
  onNotificationClick: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("desktop:notification-clicked", listener);
    return () => ipcRenderer.removeListener("desktop:notification-clicked", listener);
  },
  quitApp: () => ipcRenderer.invoke("desktop:quit-app"),
});
