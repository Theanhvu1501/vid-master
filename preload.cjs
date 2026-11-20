const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  selectFolder: () => ipcRenderer.invoke("select-folder"),
  selectFile: (options) => ipcRenderer.invoke("select-file", options),
  runScript: (scriptPath, args, options) =>
    ipcRenderer.invoke("run-script", scriptPath, args, options),
  saveRenderConfig: (config) =>
    ipcRenderer.invoke("save-render-config", config),
  loadRenderConfig: () => ipcRenderer.invoke("load-render-config"),
  openNewWindow: () => ipcRenderer.invoke("open-new-window"),
  downloadYtDlp: () => ipcRenderer.invoke("download-ytdlp"),
  getProjects: () => ipcRenderer.invoke("get-projects"),
  getProjectsWithMeta: () => ipcRenderer.invoke("get-projects-with-meta"),
  createProject: (projectName) =>
    ipcRenderer.invoke("create-project", projectName),
  deleteProject: (projectName) =>
    ipcRenderer.invoke("delete-project", projectName),
  saveProjectConfig: (projectName, config) =>
    ipcRenderer.invoke("save-project-config", projectName, config),
  loadProjectConfig: (projectName) =>
    ipcRenderer.invoke("load-project-config", projectName),
  getCurrentProject: () => ipcRenderer.invoke("get-current-project"),
  setCurrentProject: (projectName) =>
    ipcRenderer.invoke("set-current-project", projectName),
  setProjectLastRender: (projectName) =>
    ipcRenderer.invoke("set-project-last-render", projectName),
  setProjectStarred: (projectName, starred) =>
    ipcRenderer.invoke("set-project-starred", projectName, starred),
  syncConfigFiles: (configs) =>
    ipcRenderer.invoke("sync-config-files", configs),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  downloadUpdate: () => ipcRenderer.invoke("download-update"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  onUpdateStatus: (callback) => {
    ipcRenderer.on("update-status", (event, data) => callback(data));
  },
  onUpdateProgress: (callback) => {
    ipcRenderer.on("update-progress", (event, data) => callback(data));
  },
  removeUpdateListeners: () => {
    ipcRenderer.removeAllListeners("update-status");
    ipcRenderer.removeAllListeners("update-progress");
  },
  onScriptOutput: (callback) => {
    ipcRenderer.on("script-output", (event, data) => callback(data));
  },
  removeScriptOutputListener: () => {
    ipcRenderer.removeAllListeners("script-output");
  },
  detectGpuCodec: () => ipcRenderer.invoke("detect-gpu-codec"),
  // Cài đặt yt-dlp dùng chung toàn app (không thuộc project nào).
  ytdlp: {
    getSettings: () => ipcRenderer.invoke("ytdlp:get-settings"),
    saveSettings: (s) => ipcRenderer.invoke("ytdlp:save-settings", s),
  },
  sheet: {
    testConnection: (s) => ipcRenderer.invoke("sheet:test-connection", s),
    channelsList: () => ipcRenderer.invoke("channels:list"),
    channelsUpdate: (id, body) => ipcRenderer.invoke("channels:update", { id, body }),
    proxyAuthStatus: () => ipcRenderer.invoke("proxy-auth:status"),
    proxyAuthSet: (name, user, pass) => ipcRenderer.invoke("proxy-auth:set", { name, user, pass }),
    proxyAuthImport: () => ipcRenderer.invoke("proxy-auth:import"),
    loadSettings: () => ipcRenderer.invoke("sheet:load-settings"),
    saveSettings: (s) => ipcRenderer.invoke("sheet:save-settings", s),
    selectRoot: () => ipcRenderer.invoke("sheet:select-root"),
    start: () => ipcRenderer.invoke("sheet:start"),
    stop: () => ipcRenderer.invoke("sheet:stop"),
    runNow: (sheetName) => ipcRenderer.invoke("sheet:run-now", sheetName),
    testRender: (sheetName) => ipcRenderer.invoke("sheet:test-render", sheetName),
    // Video đã render nhưng chưa lên lịch (panel "Chờ đăng").
    pendingUploads: (sheetName) => ipcRenderer.invoke("sheet:pending-uploads", sheetName),
    // Đăng lại thủ công — chỉ upload lại file đã render, không tải/render lại.
    retryUpload: ({ sheetName, urls } = {}) => ipcRenderer.invoke("sheet:retry-upload", { sheetName, urls }),
    listStatsChannels: () => ipcRenderer.invoke("yt:list-channels"),
    refreshStats: () => ipcRenderer.invoke("yt:refresh-stats"),
    fetchSourceUrls: (sheetName, sortBy) => ipcRenderer.invoke("yt:fetch-source-urls", { sheetName, sortBy }),
    onEvent: (cb) => ipcRenderer.on("sheet:event", (e, data) => cb(data)),
    removeEventListener: () => ipcRenderer.removeAllListeners("sheet:event"),
    // Giám sát trên web: trạng thái kết nối tới server (chỉ đọc).
    monitorStatus: () => ipcRenderer.invoke("monitor:get-status"),
    // Tài khoản đang đăng nhập trên máy này
    accountGet: () => ipcRenderer.invoke("account:get"),
    accountLogout: () => ipcRenderer.invoke("account:logout"),
    onMonitorStatus: (cb) => ipcRenderer.on("monitor:status", (e, data) => cb(data)),
    gpmTest: (gpmHost) => ipcRenderer.invoke("gpm:test", { gpmHost }),
    gpmListChannels: () => ipcRenderer.invoke("gpm:list-channels"),
    gpmListGroups: (gpmHost) => ipcRenderer.invoke("gpm:list-groups", { gpmHost }),
    gpmListProfilesFull: (gpmHost) => ipcRenderer.invoke("gpm:list-profiles-full", { gpmHost }),
    gpmConnect: (args) => ipcRenderer.invoke("gpm:connect", args),
    gpmTestTelegram: (token, chatId, topicId) => ipcRenderer.invoke("gpm:test-telegram", { token, chatId, topicId }),
  },
  // Giai đoạn 2A — tab Composer (sheet/composer-ipc.js). Namespace RIÊNG, không đụng các khối
  // ở trên: mọi kênh mới của composer nằm gọn trong đây.
  composer: {
    presetsDir: () => ipcRenderer.invoke("composer:presetsDir"),
    list: () => ipcRenderer.invoke("composer:list"),
    load: (name) => ipcRenderer.invoke("composer:load", name),
    save: (preset) => ipcRenderer.invoke("composer:save", preset),
    delete: (name) => ipcRenderer.invoke("composer:delete", name),
    validate: (preset) => ipcRenderer.invoke("composer:validate", preset),
    pickAsset: (options) => ipcRenderer.invoke("composer:pickAsset", options),
    previewFrame: (opts) => ipcRenderer.invoke("composer:previewFrame", opts),
    // Giai đoạn 2B — canvas kéo thả: khung hình đại diện thật cho lớp background/overlay/video.
    extractThumb: (opts) => ipcRenderer.invoke("composer:extractThumb", opts),
    renderTest: (opts) => ipcRenderer.invoke("composer:renderTest", opts),
    onRenderTestLog: (cb) => ipcRenderer.on("composer:renderTestLog", (event, data) => cb(data)),
    removeRenderTestLogListener: () => ipcRenderer.removeAllListeners("composer:renderTestLog"),
  },
  // Tự động hoá: chạy trên profile GPM đã chọn (danh sách lấy từ GPM local).
  automation: {
    login: (opts) => ipcRenderer.invoke("automation:login", opts),
    changeThumb: (opts) => ipcRenderer.invoke("automation:change-thumb", opts),
    schedule: (opts) => ipcRenderer.invoke("automation:schedule", opts),
    distribute: (opts) => ipcRenderer.invoke("automation:distribute", opts),
    proxyCheck: (opts) => ipcRenderer.invoke("automation:proxy-check", opts),
    createChannel: (opts) => ipcRenderer.invoke("automation:create-channel", opts),
    previewExcel: (opts) => ipcRenderer.invoke("automation:preview-excel", opts),
    previewRun: (opts) => ipcRenderer.invoke("automation:preview-run", opts),
    distributePreview: (opts) => ipcRenderer.invoke("automation:distribute-preview", opts),
    stop: () => ipcRenderer.invoke("automation:stop"),
    saveSample: (kind) => ipcRenderer.invoke("excel-sample:save", { kind }),
    onLog: (cb) => ipcRenderer.on("automation:log", (event, msg) => cb(msg)),
    removeLogListener: () => ipcRenderer.removeAllListeners("automation:log"),
  },
});
