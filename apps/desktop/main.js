const { app, BrowserWindow, Menu, ipcMain, dialog, shell, session } = require("electron");
const fs = require("fs");
const path = require("path");

const DEFAULT_SERVER_URL =
  process.env.DESKTOP_DEFAULT_SERVER_URL || "http://localhost";

let mainWindow = null;

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
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function readConfig() {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return { serverUrl: DEFAULT_SERVER_URL };
  }

  try {
    const data = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return {
      serverUrl: normalizeServerUrl(data.serverUrl) || DEFAULT_SERVER_URL,
    };
  } catch {
    return { serverUrl: DEFAULT_SERVER_URL };
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

function loadConfigScreen(errorMessage = "") {
  if (!mainWindow) {
    return;
  }

  const filePath = path.join(__dirname, "config.html");
  const query = {};
  if (errorMessage) {
    query.error = errorMessage;
  }
  mainWindow.loadFile(filePath, { query });
}

async function loadChatApp() {
  const serverUrl = getServerUrl();

  try {
    await mainWindow.loadURL(serverUrl);
  } catch {
    loadConfigScreen("Khong ket noi duoc toi server. Kiem tra lai SERVER_BASE_URL.");
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

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  loadChatApp();
}

function createAppMenu() {
  const template = [
    {
      label: "Company Chat",
      submenu: [
        {
          label: "Cau hinh server",
          click: () => loadConfigScreen(),
        },
        {
          label: "Tai lai",
          accelerator: "CmdOrCtrl+R",
          click: () => {
            if (mainWindow) {
              loadChatApp();
            }
          },
        },
        {
          label: "Mo DevTools",
          accelerator: "Alt+CmdOrCtrl+I",
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.openDevTools({ mode: "detach" });
            }
          },
        },
        { type: "separator" },
        { role: "quit", label: "Thoat" },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === "notifications") {
      callback(true);
      return;
    }
    callback(false);
  });

  createAppMenu();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

ipcMain.handle("desktop:get-config", () => {
  return readConfig();
});

ipcMain.handle("desktop:save-config", async (_event, payload) => {
  const serverUrl = normalizeServerUrl(payload?.serverUrl);
  if (!serverUrl) {
    return { ok: false, message: "Server URL khong hop le. Vi du: https://chat.company.vn" };
  }

  writeConfig({ serverUrl });
  await loadChatApp();
  return { ok: true };
});

ipcMain.handle("desktop:reload-chat", async () => {
  await loadChatApp();
  return { ok: true };
});

ipcMain.handle("desktop:show-server-example", async () => {
  await dialog.showMessageBox({
    type: "info",
    title: "Vi du server URL",
    message: "Nhap URL server self-host cua anh, vi du:\nhttps://chat.company.vn\nhoac http://192.168.1.10",
  });
  return { ok: true };
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
