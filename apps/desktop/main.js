const { app, BrowserWindow, Menu, ipcMain, dialog, shell, session } = require("electron");
const fs = require("fs");
const path = require("path");

const DEFAULT_SERVER_URL =
  process.env.DESKTOP_DEFAULT_SERVER_URL || "http://localhost:3000";

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
      companyName: "Company Chat",
      logoDataUrl: "",
    };
  }

  try {
    const data = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return {
      serverUrl: normalizeServerUrl(data.serverUrl) || DEFAULT_SERVER_URL,
      companyName: String(data.companyName || "Company Chat").trim() || "Company Chat",
      logoDataUrl: typeof data.logoDataUrl === "string" ? data.logoDataUrl : "",
    };
  } catch {
    return {
      serverUrl: DEFAULT_SERVER_URL,
      companyName: "Company Chat",
      logoDataUrl: "",
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
      label: "Cấu hình",
      submenu: [
        {
          label: "Cấu hình",
          submenu: [
            {
              label: "URL server",
              click: () => loadConfigScreen("", "server"),
            },
            {
              label: "Tên công ty",
              click: () => loadConfigScreen("", "branding"),
            },
            {
              label: "Logo công ty",
              click: () => loadConfigScreen("", "branding"),
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
    return {
      ok: false,
      message: "Server URL không hợp lệ. Ví dụ: https://chat.company.vn hoặc http://localhost:3000",
    };
  }

  writeConfig({
    serverUrl,
    companyName:
      String(payload?.companyName || "").trim() || "Company Chat",
    logoDataUrl: typeof payload?.logoDataUrl === "string" ? payload.logoDataUrl : "",
  });
  await loadChatApp();
  return { ok: true };
});

ipcMain.handle("desktop:reload-chat", async () => {
  await loadChatApp();
  return { ok: true };
});

ipcMain.handle("desktop:pick-logo", async () => {
  const result = await dialog.showOpenDialog({
    title: "Chọn logo công ty",
    properties: ["openFile"],
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "svg"] }],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false };
  }

  const filePath = result.filePaths[0];
  const ext = path.extname(filePath).toLowerCase();
  const mimeType =
    ext === ".png"
      ? "image/png"
      : ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : ext === ".webp"
          ? "image/webp"
          : ext === ".svg"
            ? "image/svg+xml"
            : "application/octet-stream";

  const fileBuffer = fs.readFileSync(filePath);
  return {
    ok: true,
    dataUrl: `data:${mimeType};base64,${fileBuffer.toString("base64")}`,
  };
});

ipcMain.handle("desktop:quit-app", () => {
  app.quit();
  return { ok: true };
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
