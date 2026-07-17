const { app, BrowserWindow, Menu, Tray, Notification, nativeImage, ipcMain, shell, session, systemPreferences } = require("electron");
const fs = require("fs");
const path = require("path");

const DEFAULT_SERVER_URL =
  process.env.DESKTOP_DEFAULT_SERVER_URL || "http://localhost:3000";

let mainWindow = null;
let tray = null;
let isQuitting = false;

app.setName("Company Chat");

function getAppIconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "icon.png")
    : path.resolve(__dirname, "../../icon.png");
}

function getNotificationBootstrapPath() {
  return path.join(app.getPath("userData"), "notification-bootstrap.json");
}

function getConfigPath() {
  return path.join(app.getPath("userData"), "desktop-config.json");
}

function normalizeServerUrl(value) {
  const input = String(value || "").trim();
  if (!input) {
    return "";
  }

  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }

    if (
      !url.port &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    ) {
      url.port = "3000";
    }

    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function readConfig() {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return {
      serverUrl: DEFAULT_SERVER_URL,
    };
  }

  try {
    const data = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return {
      serverUrl: normalizeServerUrl(data.serverUrl) || DEFAULT_SERVER_URL,
    };
  } catch {
    return {
      serverUrl: DEFAULT_SERVER_URL,
    };
  }
}

function writeConfig(nextConfig) {
  const configPath = getConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(nextConfig, null, 2));
}

function getServerUrl() {
  return readConfig().serverUrl || DEFAULT_SERVER_URL;
}

function createFallbackTrayIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <rect x="8" y="8" width="48" height="48" rx="14" fill="#3b77ff"/>
      <path d="M23 24.5h18a6.5 6.5 0 0 1 6.5 6.5v10A6.5 6.5 0 0 1 41 47.5H31.5l-8.5 6v-22.5A6.5 6.5 0 0 1 29.5 24.5Z" fill="none" stroke="#ffffff" stroke-width="4" stroke-linejoin="round"/>
    </svg>
  `;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
}

function createTrayIcon() {
  const iconPath = getAppIconPath();
  if (fs.existsSync(iconPath)) {
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) {
      return icon.resize({
        width: process.platform === "darwin" ? 20 : 24,
        height: process.platform === "darwin" ? 20 : 24,
      });
    }
  }

  return createFallbackTrayIcon();
}

function showElectronNotification(payload = {}) {
  if (!Notification.isSupported()) {
    return false;
  }

  const icon = createTrayIcon();
  const notification = new Notification({
    title: String(payload.title || "Company Chat"),
    subtitle: payload.subtitle ? String(payload.subtitle) : undefined,
    body: String(payload.body || ""),
    icon,
    silent: Boolean(payload.silent),
  });

  notification.on("click", () => {
    showMainWindow();
    if (mainWindow && payload.conversationId) {
      mainWindow.webContents.send("desktop:notification-clicked", {
        conversationId: String(payload.conversationId),
      });
    }
  });

  notification.show();
  return true;
}

function showNativeNotification(payload = {}) {
  return showElectronNotification(payload);
}

function showMainWindow() {
  if (!mainWindow) {
    createMainWindow();
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

async function requestMediaAccess(kind = "audio") {
  if (process.platform !== "darwin") {
    return { camera: true, microphone: true, settingsOpened: false };
  }

  const needsCamera = kind === "video";
  let camera = !needsCamera || systemPreferences.getMediaAccessStatus("camera") === "granted";
  let microphone = systemPreferences.getMediaAccessStatus("microphone") === "granted";

  if (needsCamera && !camera && systemPreferences.getMediaAccessStatus("camera") === "not-determined") {
    camera = await systemPreferences.askForMediaAccess("camera");
  }
  if (!microphone && systemPreferences.getMediaAccessStatus("microphone") === "not-determined") {
    microphone = await systemPreferences.askForMediaAccess("microphone");
  }

  const settingsOpened = !camera || !microphone;
  if (settingsOpened) {
    await shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Camera");
  }

  return { camera, microphone, settingsOpened };
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: "Mở ứng dụng",
      click: () => showMainWindow(),
    },
    {
      label: "Tải lại",
      click: () => {
        if (mainWindow) {
          loadChatApp();
        }
      },
    },
    {
      label: "Thông báo thử",
      click: () => {
        void showNativeNotification({
          title: "Company Chat",
          body: "Đây là thông báo thử từ ứng dụng desktop.",
          silent: false,
        });
      },
    },
    { type: "separator" },
    {
      label: "Thoát",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function createTray() {
  if (tray) {
    return;
  }

  tray = new Tray(createTrayIcon());
  tray.setToolTip("Company Chat");
  tray.setContextMenu(buildTrayMenu());
  tray.on("double-click", () => showMainWindow());
  tray.on("click", () => showMainWindow());
}

function updateBadgeCount(count) {
  const safeCount = Math.max(0, Number(count) || 0);
  if (process.platform === "darwin" && app.dock) {
    app.dock.setBadge(safeCount > 0 ? String(safeCount) : "");
  }
  if (tray) {
    tray.setToolTip(safeCount > 0 ? `Company Chat (${safeCount} chưa đọc)` : "Company Chat");
  }
}

function loadConfigScreen(errorMessage = "", section = "server") {
  if (!mainWindow) {
    return;
  }

  const filePath = path.join(__dirname, "config.html");
  const query = {};
  if (errorMessage) {
    query.error = errorMessage;
  }
  if (section) {
    query.section = section;
  }
  mainWindow.loadFile(filePath, { query });
}

async function loadChatApp() {
  const serverUrl = getServerUrl();

  try {
    if (mainWindow?.webContents?.session) {
      await mainWindow.webContents.session.clearCache().catch(() => {
        // ignore runtime cache clear failures
      });
    }
    await mainWindow.loadURL(serverUrl);
  } catch {
    loadConfigScreen(
      "Không kết nối được tới server. Nếu đang chạy local, hãy dùng http://localhost:3000.",
    );
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    title: "Company Chat",
    backgroundColor: "#161a22",
    autoHideMenuBar: false,
    icon: fs.existsSync(getAppIconPath()) ? getAppIconPath() : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  loadChatApp();
}

function createAppMenu() {
  const template = [
    {
      label: "Cấu hình",
      submenu: [
        {
          label: "Cấu hình",
          submenu: [
            {
              label: "URL server",
              click: () => loadConfigScreen("", "server"),
            },
          ],
        },
        {
          label: "Tải lại",
          accelerator: "CmdOrCtrl+R",
          click: () => {
            if (mainWindow) {
              loadChatApp();
            }
          },
        },
        {
          label: "Thông báo thử",
          click: () => {
            void showNativeNotification({
              title: "Company Chat",
              body: "Đây là thông báo thử từ ứng dụng desktop.",
              silent: false,
            });
          },
        },
        {
          label: "Mở DevTools",
          accelerator: "Alt+CmdOrCtrl+I",
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.openDevTools({ mode: "detach" });
            }
          },
        },
        { type: "separator" },
        { role: "quit", label: "Thoát" },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  const appIconPath = getAppIconPath();
  if (process.platform === "darwin" && app.dock && fs.existsSync(appIconPath)) {
    app.dock.setIcon(appIconPath);
  }

  if (process.platform === "win32") {
    app.setAppUserModelId("vn.lvquy.companychat");
  }

  void session.defaultSession.clearCache().catch(() => {
    // ignore cache clear failures
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === "notifications" || permission === "media") {
      callback(true);
      return;
    }
    callback(false);
  });

  createAppMenu();
  createTray();
  createMainWindow();

  try {
    const bootstrapPath = getNotificationBootstrapPath();
    if (!fs.existsSync(bootstrapPath)) {
      void showNativeNotification({
        title: "Company Chat",
        body: "Ứng dụng đã sẵn sàng nhận thông báo nền.",
        silent: false,
      });
      fs.writeFileSync(bootstrapPath, JSON.stringify({ createdAt: new Date().toISOString() }, null, 2));
    }
  } catch {
    // ignore notification bootstrap persistence failures
  }

  app.on("activate", () => {
    if (!mainWindow) {
      createMainWindow();
      return;
    }
    showMainWindow();
  });
});

ipcMain.handle("desktop:get-config", () => {
  return readConfig();
});

ipcMain.handle("desktop:save-config", async (_event, payload) => {
  const serverUrl = normalizeServerUrl(payload?.serverUrl);
  if (!serverUrl) {
    return {
      ok: false,
      message: "Server URL không hợp lệ. Ví dụ: https://chat.company.vn hoặc http://localhost:3000",
    };
  }

  writeConfig({
    serverUrl,
  });
  await loadChatApp();
  return { ok: true };
});

ipcMain.handle("desktop:reload-chat", async () => {
  await loadChatApp();
  return { ok: true };
});

ipcMain.handle("desktop:notify", async (_event, payload) => {
  return {
    ok: await showNativeNotification(payload),
  };
});

ipcMain.handle("desktop:request-media-access", async (_event, kind) => {
  return requestMediaAccess(kind === "video" ? "video" : "audio");
});

ipcMain.handle("desktop:set-badge-count", (_event, count) => {
  updateBadgeCount(count);
  return { ok: true };
});

ipcMain.handle("desktop:quit-app", () => {
  isQuitting = true;
  app.quit();
  return { ok: true };
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && isQuitting) {
    app.quit();
  }
});
