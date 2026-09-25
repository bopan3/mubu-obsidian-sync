var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => MubuSyncPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian4 = require("obsidian");

// src/auth.ts
var import_obsidian2 = require("obsidian");

// src/auth-state.ts
function isAuthenticationMessage(message) {
  return /token|jwt|登录|认证|未授权|expired|expire|session|login\s+(?:expired|inspired|invalid)/i.test(message);
}

// src/login-navigation.ts
var AUTH_HOSTS = /* @__PURE__ */ new Set([
  "open.weixin.qq.com",
  "open.work.weixin.qq.com",
  "graph.qq.com",
  "accounts.google.com"
]);
function isAllowedLoginNavigation(rawUrl) {
  if (rawUrl === "about:blank") return true;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return host === "mubu.com" || host.endsWith(".mubu.com") || AUTH_HOSTS.has(host);
  } catch {
    return false;
  }
}
function safeUrlForLog(rawUrl) {
  if (rawUrl === "about:blank") return rawUrl;
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "[invalid URL]";
  }
}

// src/mubu-api.ts
var import_obsidian = require("obsidian");
var API = {
  documentsPage: "https://api2.mubu.com/v3/api/list/get_all_documents_page",
  list: "https://api2.mubu.com/v3/api/list/get",
  folders: "https://api2.mubu.com/v3/api/list/get_folder",
  documentDetail: "https://api2.mubu.com/v3/api/document/edit/get"
};
var MubuApiError = class extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "MubuApiError";
    this.status = options.status;
    this.code = options.code;
  }
  get isAuthenticationError() {
    return this.status === 401 || this.status === 403 || isAuthenticationMessage(this.message);
  }
};
var MubuClient = class {
  constructor(jwtToken) {
    this.jwtToken = jwtToken;
  }
  async verifyAuthentication() {
    await this.post(API.folders, {});
  }
  async fetchCatalog() {
    const folders = /* @__PURE__ */ new Map();
    const documents = /* @__PURE__ */ new Map();
    await this.fetchPagedDocuments(folders, documents);
    await this.fetchFolderDirectory(folders);
    await this.fetchRecursiveDirectory(folders, documents);
    const folderPaths = buildFolderPaths(folders);
    const result = [];
    for (const document of documents.values()) {
      const id = stringValue(document.id);
      if (!id) continue;
      const folderId = firstString(document, ["folderId", "folder_id"]);
      result.push({
        id,
        title: firstString(document, ["name", "title"]) || "\u672A\u547D\u540D\u6587\u6863",
        folderId,
        folderPath: folderPaths.get(folderId) ?? "",
        type: primitiveValue(document.type),
        revisionHint: firstString(document, [
          "updatedAt",
          "updated_at",
          "modified",
          "modifyTime",
          "baseVersion",
          "version"
        ]) || void 0
      });
    }
    return result.sort((a, b) => {
      const pathOrder = a.folderPath.localeCompare(b.folderPath, "zh-CN");
      return pathOrder || a.title.localeCompare(b.title, "zh-CN") || a.id.localeCompare(b.id);
    });
  }
  async fetchDocument(summary) {
    const raw = asRecord(await this.post(API.documentDetail, {
      docId: summary.id,
      password: "",
      isFromDocDir: true
    }));
    const definitionRaw = raw.definition;
    let definition;
    if (typeof definitionRaw === "string") {
      try {
        definition = JSON.parse(definitionRaw);
      } catch (error) {
        throw new MubuApiError(`\u6587\u6863\u201C${summary.title}\u201D\u7684 definition \u65E0\u6CD5\u89E3\u6790\uFF1A${errorMessage(error)}`);
      }
    } else if (definitionRaw && typeof definitionRaw === "object") {
      definition = definitionRaw;
    } else {
      throw new MubuApiError(`\u6587\u6863\u201C${summary.title}\u201D\u6CA1\u6709\u8FD4\u56DE definition`);
    }
    return {
      id: summary.id,
      title: firstString(raw, ["name", "title"]) || summary.title,
      definition,
      baseVersion: firstString(raw, ["baseVersion", "version"]) || void 0,
      raw
    };
  }
  async fetchPagedDocuments(folders, documents) {
    let start = "";
    for (let page = 0; page < 100; page += 1) {
      const data = asRecord(await this.post(API.documentsPage, { start }));
      mergeFolders(folders, data.folders);
      mergeDocuments(documents, data.documents);
      const next = firstString(data, ["nextStart", "next_start", "next"]);
      if (!next) return;
      if (next === start) {
        throw new MubuApiError("\u5E55\u5E03\u6587\u6863\u5217\u8868\u5206\u9875\u6E38\u6807\u6CA1\u6709\u524D\u8FDB\uFF0C\u5DF2\u505C\u6B62\u540C\u6B65");
      }
      start = next;
    }
    throw new MubuApiError("\u5E55\u5E03\u6587\u6863\u5217\u8868\u8D85\u8FC7 100 \u9875\uFF0C\u5DF2\u505C\u6B62\u540C\u6B65\u4EE5\u907F\u514D\u9057\u6F0F");
  }
  async fetchFolderDirectory(folders) {
    const data = await this.post(API.folders, {});
    mergeFolders(folders, data);
  }
  async fetchRecursiveDirectory(folders, documents) {
    const pending = ["0"];
    const visited = /* @__PURE__ */ new Set();
    while (pending.length > 0) {
      const folderId = pending.shift();
      if (folderId === void 0 || visited.has(folderId)) continue;
      visited.add(folderId);
      const data = asRecord(await this.post(API.list, folderId === "0" ? {} : { folderId }));
      mergeFolders(folders, data.folders);
      mergeDocuments(documents, data.documents);
      for (const rawFolder of arrayValue(data.folders)) {
        const childId = stringValue(asRecord(rawFolder).id);
        if (childId && !visited.has(childId)) pending.push(childId);
      }
    }
  }
  async post(url, body) {
    try {
      const response = await (0, import_obsidian.requestUrl)({
        url,
        method: "POST",
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
          "jwt-token": this.jwtToken,
          Origin: "https://mubu.com",
          Referer: "https://mubu.com/"
        },
        body: JSON.stringify(body),
        throw: false
      });
      const envelope = response.json;
      if (response.status >= 400) {
        throw new MubuApiError(
          envelope?.msg || envelope?.message || `\u5E55\u5E03\u63A5\u53E3\u8FD4\u56DE HTTP ${response.status}`,
          { status: response.status, code: envelope?.code }
        );
      }
      if (typeof envelope?.code === "number" && envelope.code !== 0) {
        throw new MubuApiError(
          envelope.msg || envelope.message || `\u5E55\u5E03\u63A5\u53E3\u8FD4\u56DE code=${envelope.code}`,
          { status: response.status, code: envelope.code }
        );
      }
      return envelope?.data ?? {};
    } catch (error) {
      if (error instanceof MubuApiError) throw error;
      throw new MubuApiError(`\u5E55\u5E03\u7F51\u7EDC\u8BF7\u6C42\u5931\u8D25\uFF1A${errorMessage(error)}`);
    }
  }
};
function mergeFolders(target, input) {
  for (const item of arrayValue(input)) {
    const raw = asRecord(item);
    const id = stringValue(raw.id);
    if (!id) continue;
    target.set(id, {
      id,
      name: stringValue(raw.name),
      folderId: stringValue(raw.folderId),
      folder_id: stringValue(raw.folder_id)
    });
  }
}
function mergeDocuments(target, input) {
  for (const item of arrayValue(input)) {
    const raw = asRecord(item);
    const id = stringValue(raw.id);
    if (id) target.set(id, raw);
  }
}
function buildFolderPaths(folders) {
  const paths = /* @__PURE__ */ new Map();
  const visit = (id, ancestors) => {
    if (!id || id === "0") return "";
    const cached = paths.get(id);
    if (cached !== void 0) return cached;
    if (ancestors.has(id)) return "";
    const folder = folders.get(id);
    if (!folder) return "";
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(id);
    const parentId = folder.folderId ?? folder.folder_id ?? "";
    const parent = visit(parentId, nextAncestors);
    const name = sanitizePathPart(folder.name || "\u672A\u547D\u540D\u6587\u4EF6\u5939", id);
    const path = parent ? `${parent}/${name}` : name;
    paths.set(id, path);
    return path;
  };
  for (const id of folders.keys()) visit(id, /* @__PURE__ */ new Set());
  return paths;
}
function sanitizePathPart(value, fallback = "\u672A\u547D\u540D") {
  const cleaned = value.replace(/[\\/:*?"<>|#^[\]]/g, "-").replace(/[\u0000-\u001f]/g, "").replace(/\s+/g, " ").replace(/[. ]+$/g, "").trim();
  return cleaned || fallback;
}
function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}
function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function stringValue(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}
function primitiveValue(value) {
  return typeof value === "string" || typeof value === "number" ? value : void 0;
}
function firstString(record, keys) {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) return value;
  }
  return "";
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

// src/auth.ts
var LOGIN_URL = "https://mubu.com";
var LOGIN_PAGE_URL = "https://mubu.com/login";
var SESSION_PARTITION = "persist:mubu-sync";
var JWT_COOKIE_NAME = "Jwt-Token";
async function clearMubuLoginSession() {
  const session = resolveSession();
  if (!session) return;
  await clearMubuSessionData(session);
}
async function loginToMubu(verifyToken) {
  if (!import_obsidian2.Platform.isDesktop) {
    throw new Error("\u5E55\u5E03\u81EA\u52A8\u767B\u5F55\u76EE\u524D\u4EC5\u652F\u6301 Obsidian \u684C\u9762\u7248");
  }
  const BrowserWindow = resolveBrowserWindow();
  if (!BrowserWindow) {
    throw new Error("\u5F53\u524D Obsidian \u65E0\u6CD5\u6253\u5F00\u5E55\u5E03\u767B\u5F55\u7A97\u53E3\uFF0C\u8BF7\u4F7F\u7528\u624B\u52A8 Token \u6A21\u5F0F");
  }
  const win = new BrowserWindow({
    width: 480,
    height: 720,
    title: "\u767B\u5F55\u5E55\u5E03",
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      partition: SESSION_PARTITION
    }
  });
  configureLoginWindow(win);
  await clearMubuSessionData(win.webContents.session);
  if (win.isDestroyed()) return null;
  return new Promise((resolve, reject) => {
    let settled = false;
    let checking = false;
    let rejectedToken = "";
    const finish = (token) => {
      if (settled) return;
      settled = true;
      window.clearInterval(timer);
      resolve(token);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      window.clearInterval(timer);
      reject(error);
    };
    const timer = window.setInterval(() => {
      if (checking || settled || win.isDestroyed()) return;
      checking = true;
      void readJwtToken(win.webContents.session).then(async (token) => {
        if (!token || settled || token === rejectedToken) return;
        try {
          await verifyToken(token);
          finish(token);
          if (!win.isDestroyed()) win.close();
        } catch (error) {
          if (!isExpiredMubuLogin(error)) throw error;
          rejectedToken = token;
          await clearJwtCookie(win.webContents.session);
          if (!win.isDestroyed()) {
            new import_obsidian2.Notice("\u5E55\u5E03\u767B\u5F55\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u5728\u7A97\u53E3\u4E2D\u91CD\u65B0\u767B\u5F55");
            await Promise.resolve(win.loadURL(LOGIN_PAGE_URL));
          }
        }
      }).catch((error) => {
        if (!isExpiredMubuLogin(error)) {
          fail(error);
          if (!win.isDestroyed()) win.close();
        }
      }).finally(() => {
        checking = false;
      });
    }, 1e3);
    win.on("closed", () => finish(null));
    try {
      void win.loadURL(LOGIN_PAGE_URL);
    } catch (error) {
      fail(error);
    }
  });
}
async function readJwtToken(session) {
  const cookies = await session.cookies.get({});
  const token = cookies.find((cookie) => cookie.name.toLowerCase() === JWT_COOKIE_NAME.toLowerCase() && isMubuCookie(cookie))?.value.trim();
  return token || null;
}
async function clearJwtCookie(session) {
  try {
    const cookies = (await session.cookies.get({})).filter((cookie) => cookie.name.toLowerCase() === JWT_COOKIE_NAME.toLowerCase() && isMubuCookie(cookie));
    if (cookies.length === 0) await session.cookies.remove(LOGIN_URL, JWT_COOKIE_NAME);
    else await Promise.all(cookies.map((cookie) => session.cookies.remove(cookieUrl(cookie), cookie.name)));
  } catch (error) {
    console.warn("[Mubu Sync] Could not clear expired Mubu login cookie", error);
  }
}
function isMubuCookie(cookie) {
  const domain = (cookie.domain || "mubu.com").replace(/^\./, "").toLowerCase();
  return domain === "mubu.com" || domain.endsWith(".mubu.com");
}
function cookieUrl(cookie) {
  const domain = (cookie.domain || "mubu.com").replace(/^\./, "");
  return `${cookie.secure === false ? "http" : "https"}://${domain}${cookie.path || "/"}`;
}
async function clearMubuSessionData(session) {
  try {
    await session.clearStorageData?.({ storages: ["cookies", "localstorage", "indexeddb"] });
  } catch (error) {
    console.warn("[Mubu Sync] Could not clear Mubu login storage", error);
  }
  try {
    const cookies = (await session.cookies.get({})).filter(isMubuCookie);
    await Promise.all(cookies.map((cookie) => session.cookies.remove(cookieUrl(cookie), cookie.name)));
  } catch (error) {
    console.warn("[Mubu Sync] Could not clear Mubu login cookies", error);
  }
}
function configureLoginWindow(win) {
  const contents = win.webContents;
  const userAgent = contents.getUserAgent?.();
  if (userAgent && contents.setUserAgent) {
    contents.setUserAgent(userAgent.replace(/\s+(?:electron|obsidian)\/[\w.-]+/gi, "").replace(/\s{2,}/g, " ").trim());
  }
  contents.removeAllListeners?.("will-navigate");
  contents.setWindowOpenHandler?.(({ url }) => {
    if (!isAllowedLoginNavigation(url)) {
      console.warn(`[Mubu Sync] Blocked login popup: ${safeUrlForLog(url)}`);
      return { action: "deny" };
    }
    return { action: "allow", overrideBrowserWindowOptions: {
      parent: win,
      show: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: SESSION_PARTITION }
    } };
  });
  contents.on?.("will-navigate", (event, url) => {
    if (!isAllowedLoginNavigation(url)) event.preventDefault();
  });
  contents.on?.("did-create-window", (child) => configureLoginWindow(child));
}
function isExpiredMubuLogin(error) {
  return error instanceof MubuApiError ? error.isAuthenticationError : isAuthenticationMessage(error instanceof Error ? error.message : String(error));
}
function resolveBrowserWindow() {
  const requireFn = window.require;
  if (!requireFn) return null;
  try {
    const electron = requireFn("electron");
    if (electron.remote?.BrowserWindow) return electron.remote.BrowserWindow;
    if (electron.BrowserWindow) return electron.BrowserWindow;
  } catch {
  }
  try {
    const remote = requireFn("@electron/remote");
    return remote.BrowserWindow ?? null;
  } catch {
    return null;
  }
}
function resolveSession() {
  const requireFn = window.require;
  if (!requireFn) return null;
  try {
    const electron = requireFn("electron");
    const sessionModule = electron.remote?.session ?? electron.session;
    if (sessionModule) return sessionModule.fromPartition(SESSION_PARTITION);
  } catch {
  }
  try {
    const remote = requireFn("@electron/remote");
    return remote.session?.fromPartition(SESSION_PARTITION) ?? null;
  } catch {
    return null;
  }
}

// src/sync-engine.ts
var import_crypto = require("crypto");
var import_obsidian3 = require("obsidian");

// src/markdown.ts
var MANAGED_START = "<!-- mubu-sync:start -->";
var MANAGED_END = "<!-- mubu-sync:end -->";
var IMAGE_HOST = "https://document-image.mubu.com/";
function renderMubuDocument(summary, nodes, options = {}) {
  const title = summary.title.trim() || "\u672A\u547D\u540D\u6587\u6863";
  const body = renderNodeList(nodes, options);
  return [
    MANAGED_START,
    `# ${escapeMarkdownText(title)}`,
    "",
    body || "_\u7A7A\u6587\u6863_",
    MANAGED_END
  ].join("\n");
}
function createInitialFile(summary, managedBlock) {
  return [
    "---",
    "source: mubu",
    `mubu_id: ${yamlString(summary.id)}`,
    "---",
    "",
    managedBlock,
    "",
    "## \u6211\u7684\u8865\u5145",
    "",
    ""
  ].join("\n");
}
function replaceManagedBlock(existing, managedBlock) {
  const start = existing.indexOf(MANAGED_START);
  const end = existing.indexOf(MANAGED_END);
  if (start < 0 || end < start) return null;
  return `${existing.slice(0, start)}${managedBlock}${existing.slice(end + MANAGED_END.length)}`;
}
function renderNodeList(nodes, options) {
  const lines = [];
  const visit = (items, depth) => {
    for (const node of items) {
      const indent = "  ".repeat(depth);
      const task = !options.ignoreCompletionStatus && isTaskNode(node);
      const bullet = task ? isCompletedTask(node) ? "- [x] " : "- [ ] " : "- ";
      let content = htmlToMarkdown(node.text || "").trim();
      if (node.emoji) content = `${node.emoji} ${content}`.trim();
      if (!content) content = "(\u7A7A)";
      if (node.heading && node.heading > 0 && !content.includes("**")) {
        content = `**${content}**`;
      }
      const contentLines = content.split("\n");
      lines.push(`${indent}${bullet}${contentLines[0]}`.trimEnd());
      for (const continuation of contentLines.slice(1)) {
        lines.push(`${indent}  ${continuation}`.trimEnd());
      }
      if (node.deadline) {
        lines.push(`${indent}  \u{1F4C5} ${formatUnixDate(node.deadline)}`);
      }
      const note = htmlToMarkdown(node.note || "").trim();
      if (note) {
        for (const noteLine of note.split("\n")) {
          lines.push(`${indent}  > ${noteLine}`.trimEnd());
        }
      }
      for (const image of extractImages(node)) {
        const markdown = imageToMarkdown(image);
        if (markdown) lines.push(`${indent}  ${markdown}`);
      }
      if (Array.isArray(node.children) && node.children.length > 0) {
        visit(node.children, depth + 1);
      }
    }
  };
  visit(nodes, 0);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
function htmlToMarkdown(html) {
  if (!html) return "";
  const document = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  return renderChildren(document.body).replace(/\u200b/g, "").replace(/\*{4,}/g, "**").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function renderChildren(parent) {
  return Array.from(parent.childNodes).map(renderHtmlNode).join("");
}
function renderHtmlNode(node) {
  if (node.nodeType === 3) return node.textContent || "";
  if (node.nodeType !== 1) return "";
  const element = node;
  const tag = element.tagName.toLowerCase();
  const inner = renderChildren(element);
  if (tag === "span") return renderSpan(element, inner);
  switch (tag) {
    case "br":
      return "\n";
    case "p":
    case "div":
      return `${inner}
`;
    case "strong":
    case "b":
      return inner.trim() ? `**${inner.trim()}**` : "";
    case "em":
    case "i":
      return inner.trim() ? `*${inner.trim()}*` : "";
    case "s":
    case "strike":
    case "del":
      return inner.trim() ? `~~${inner.trim()}~~` : "";
    case "u":
      return inner.trim() ? `<u>${inner.trim()}</u>` : "";
    case "mark":
      return inner.trim() ? `==${inner.trim()}==` : "";
    case "code":
      return inner.trim() ? `\`${inner.trim()}\`` : "";
    case "pre":
      return inner.trim() ? `
\`\`\`
${inner.trim()}
\`\`\`
` : "";
    case "a": {
      const href = element.getAttribute("href") || "";
      const label = inner.trim() || href;
      return href ? `[${label}](${href.replace(/\)/g, "\\)")})` : label;
    }
    case "img": {
      const src = element.getAttribute("src") || "";
      const alt = element.getAttribute("alt") || "image";
      return src ? `![${escapeMarkdownText(alt)}](${src})` : "";
    }
    case "blockquote":
      return inner.trim() ? `${inner.trim().split("\n").map((line) => `> ${line}`).join("\n")}
` : "";
    case "ul":
      return renderRichList(element, false);
    case "ol":
      return renderRichList(element, true);
    case "table":
      return renderTable(element);
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return `${"#".repeat(Number(tag.slice(1)))} ${inner.trim()}
`;
    default:
      return inner;
  }
}
function renderSpan(element, inner) {
  const classes = Array.from(element.classList);
  if (classes.includes("formula")) {
    const encoded = element.getAttribute("data-raw") || "";
    if (!encoded) return "";
    try {
      return `$${decodeURIComponent(encoded)}$`;
    } catch {
      return `$${encoded}$`;
    }
  }
  let value = inner;
  if (classes.includes("codespan") && value.trim()) value = `\`${value.trim()}\``;
  if (classes.includes("bold") && value.trim()) value = `**${value.trim()}**`;
  if (classes.includes("italic") && value.trim()) value = `*${value.trim()}*`;
  if (classes.includes("underline") && value.trim()) value = `<u>${value.trim()}</u>`;
  if (classes.includes("strikethrough") && value.trim()) value = `~~${value.trim()}~~`;
  if (classes.some((name) => name.startsWith("highlight-")) && value.trim()) {
    value = `==${value.trim()}==`;
  }
  return value;
}
function renderRichList(element, ordered) {
  const lines = [];
  const children = Array.from(element.children).filter((child) => child.tagName.toLowerCase() === "li");
  children.forEach((child, index) => {
    const value = renderChildren(child).trim();
    lines.push(`${ordered ? `${index + 1}.` : "-"} ${value}`);
  });
  return `${lines.join("\n")}
`;
}
function renderTable(table) {
  const rows = Array.from(table.querySelectorAll("tr")).map(
    (row) => Array.from(row.querySelectorAll(":scope > th, :scope > td")).map((cell) => normalizeTableCell(cell.textContent || ""))
  ).filter((row) => row.length > 0);
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill("")]);
  const lines = [
    `| ${normalized[0].join(" | ")} |`,
    `| ${Array(width).fill("---").join(" | ")} |`
  ];
  for (const row of normalized.slice(1)) lines.push(`| ${row.join(" | ")} |`);
  return `
${lines.join("\n")}
`;
}
function normalizeTableCell(value) {
  return value.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}
function extractImages(node) {
  const images = [];
  if (node.image) images.push(node.image);
  if (Array.isArray(node.images)) images.push(...node.images);
  if (Array.isArray(node.imageList)) images.push(...node.imageList);
  return images;
}
function imageToMarkdown(image) {
  const raw = image.uri || image.url || "";
  if (!raw) return "";
  const url = /^https?:\/\//i.test(raw) ? raw : `${IMAGE_HOST}${raw.replace(/^\/+/, "")}`;
  const alt = escapeMarkdownText(image.alt || image.name || "image");
  return `![${alt}](${url})`;
}
function isTaskNode(node) {
  return node.taskStatus === 1 || node.finish === true || node.completed === true;
}
function isCompletedTask(node) {
  return node.finish === true || node.completed === true;
}
function formatUnixDate(timestamp) {
  const date = new Date(timestamp * 1e3);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function escapeMarkdownText(value) {
  return value.replace(/[\[\]`]/g, "").replace(/\s+/g, " ").trim();
}
function yamlString(value) {
  return JSON.stringify(value);
}

// src/sync-engine.ts
var MubuSyncEngine = class {
  constructor(options) {
    this.app = options.app;
    this.jwtToken = options.jwtToken;
    this.settings = options.settings;
    this.saveProgress = options.saveProgress;
  }
  async run() {
    const client = new MubuClient(this.jwtToken);
    const catalog = await client.fetchCatalog();
    const syncRoot = normalizeSyncRoot(this.settings.syncFolder);
    await ensureFolder(this.app, syncRoot);
    const result = {
      total: catalog.length,
      created: 0,
      updated: 0,
      moved: 0,
      archived: 0,
      unchanged: 0,
      failed: 0
    };
    const activeIds = new Set(catalog.map((document) => document.id));
    const collisions = countRemotePathCollisions(catalog, syncRoot);
    for (const summary of catalog) {
      try {
        const detail = await client.fetchDocument(summary);
        const normalizedSummary = {
          ...summary,
          title: detail.title || summary.title,
          revisionHint: detail.baseVersion || summary.revisionHint
        };
        const remoteHash = hashDefinition({
          definition: detail.definition,
          ignoreCompletionStatus: this.settings.ignoreCompletionStatus
        });
        const managedBlock = renderMubuDocument(
          normalizedSummary,
          Array.isArray(detail.definition.nodes) ? detail.definition.nodes : [],
          { ignoreCompletionStatus: this.settings.ignoreCompletionStatus }
        );
        if (this.settings.debugSaveRawResponses && detail.raw !== void 0) {
          await saveDebugResponse(this.app, summary.id, detail.raw);
        }
        await this.syncDocument(
          normalizedSummary,
          remoteHash,
          managedBlock,
          collisions,
          result
        );
        await this.saveProgress();
      } catch (error) {
        if (error instanceof MubuApiError && error.isAuthenticationError) throw error;
        result.failed += 1;
        console.error(`[Mubu Sync] Failed to sync ${summary.id} (${summary.title})`, error);
      }
    }
    if (this.settings.deleteBehavior === "archive") {
      await this.archiveMissingDocuments(activeIds, syncRoot, result);
    }
    this.settings.lastSyncTime = Date.now();
    await this.saveProgress();
    return result;
  }
  async syncDocument(summary, remoteHash, managedBlock, collisions, result) {
    const record = this.settings.syncedDocuments[summary.id];
    const preferredPath = buildPreferredPath(summary, normalizeSyncRoot(this.settings.syncFolder), collisions);
    const oldFile = record ? getFile(this.app, record.filePath) : null;
    const targetPath = await findAvailablePath(this.app, preferredPath, summary.id, oldFile?.path);
    const remoteChanged = !record || record.remoteHash !== remoteHash || record.title !== summary.title;
    let file = oldFile;
    if (file && file.path !== targetPath) {
      await ensureParentFolder(this.app, targetPath);
      await this.app.fileManager.renameFile(file, targetPath);
      file = getFile(this.app, targetPath);
      result.moved += 1;
    }
    if (!file) {
      await ensureParentFolder(this.app, targetPath);
      const existing = getFile(this.app, targetPath);
      if (existing) {
        throw new Error(`\u76EE\u6807\u6587\u4EF6\u5DF2\u5B58\u5728\u4E14\u4E0D\u5C5E\u4E8E\u5F53\u524D\u5E55\u5E03\u6587\u6863\uFF1A${targetPath}`);
      }
      file = await this.app.vault.create(targetPath, createInitialFile(summary, managedBlock));
      result.created += 1;
    } else if (remoteChanged) {
      const filePath = file.path;
      await this.app.vault.process(file, (existingContent) => {
        const merged = replaceManagedBlock(existingContent, managedBlock);
        if (merged === null) {
          throw new Error(`\u540C\u6B65\u6807\u8BB0\u5DF2\u88AB\u79FB\u9664\uFF0C\u4E3A\u907F\u514D\u8986\u76D6\u672C\u5730\u5185\u5BB9\u5DF2\u8DF3\u8FC7\uFF1A${filePath}`);
        }
        return merged;
      });
      result.updated += 1;
    } else {
      result.unchanged += 1;
    }
    const syncedRecord = {
      title: summary.title,
      folderId: summary.folderId,
      remoteHash,
      remoteRevision: summary.revisionHint,
      filePath: file.path,
      syncedAt: Date.now()
    };
    this.settings.syncedDocuments[summary.id] = syncedRecord;
  }
  async archiveMissingDocuments(activeIds, syncRoot, result) {
    const date = /* @__PURE__ */ new Date();
    const dateFolder = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
    for (const [documentId, record] of Object.entries(this.settings.syncedDocuments)) {
      if (activeIds.has(documentId)) continue;
      const file = getFile(this.app, record.filePath);
      if (file) {
        const relative = record.filePath.startsWith(`${syncRoot}/`) ? record.filePath.slice(syncRoot.length + 1) : record.filePath.split("/").pop() || `${documentId}.md`;
        const preferredArchivePath = (0, import_obsidian3.normalizePath)(`${syncRoot}/_mubu_deleted/${dateFolder}/${relative}`);
        const archivePath = await findAvailablePath(this.app, preferredArchivePath, documentId);
        await ensureParentFolder(this.app, archivePath);
        await this.app.fileManager.renameFile(file, archivePath);
        result.archived += 1;
      }
      delete this.settings.syncedDocuments[documentId];
      await this.saveProgress();
    }
  }
};
async function saveDebugResponse(app, documentId, payload) {
  const folder = ".mubu-sync-debug";
  await ensureFolder(app, folder);
  const safeId = sanitizePathPart(documentId, "document");
  await app.vault.create((0, import_obsidian3.normalizePath)(`${folder}/${Date.now()}-${safeId}.json`), `${JSON.stringify(payload, null, 2)}
`);
}
function countRemotePathCollisions(catalog, syncRoot) {
  const counts = /* @__PURE__ */ new Map();
  for (const summary of catalog) {
    const path = rawPreferredPath(summary, syncRoot);
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return counts;
}
function buildPreferredPath(summary, syncRoot, collisions) {
  const raw = rawPreferredPath(summary, syncRoot);
  if ((collisions.get(raw) ?? 0) <= 1) return raw;
  return withIdSuffix(raw, summary.id);
}
function rawPreferredPath(summary, syncRoot) {
  const folder = summary.folderPath.split("/").filter(Boolean).map((part) => sanitizePathPart(part)).join("/");
  const title = sanitizePathPart(summary.title, summary.id);
  return (0, import_obsidian3.normalizePath)([syncRoot, folder, `${title}.md`].filter(Boolean).join("/"));
}
async function findAvailablePath(app, preferredPath, documentId, currentPath) {
  const normalized = (0, import_obsidian3.normalizePath)(preferredPath);
  const existing = app.vault.getAbstractFileByPath(normalized);
  if (!existing || normalized === currentPath) return normalized;
  const suffixed = withIdSuffix(normalized, documentId);
  const suffixedExisting = app.vault.getAbstractFileByPath(suffixed);
  if (!suffixedExisting || suffixed === currentPath) return suffixed;
  for (let index = 2; index < 1e3; index += 1) {
    const candidate = suffixed.replace(/\.md$/i, `-${index}.md`);
    const candidateExisting = app.vault.getAbstractFileByPath(candidate);
    if (!candidateExisting || candidate === currentPath) return candidate;
  }
  throw new Error(`\u65E0\u6CD5\u4E3A\u5E55\u5E03\u6587\u6863\u5206\u914D\u6587\u4EF6\u540D\uFF1A${preferredPath}`);
}
function withIdSuffix(path, documentId) {
  const suffix = sanitizePathPart(documentId.slice(-8), "document");
  return path.replace(/\.md$/i, `~${suffix}.md`);
}
function hashDefinition(definition) {
  return (0, import_crypto.createHash)("sha256").update(JSON.stringify(definition)).digest("hex");
}
function normalizeSyncRoot(value) {
  const path = value.split("/").filter(Boolean).map((part) => sanitizePathPart(part)).join("/");
  return (0, import_obsidian3.normalizePath)(path || "Mubu");
}
function getFile(app, path) {
  const item = app.vault.getAbstractFileByPath((0, import_obsidian3.normalizePath)(path));
  return item instanceof import_obsidian3.TFile ? item : null;
}
async function ensureParentFolder(app, filePath) {
  const separator = filePath.lastIndexOf("/");
  if (separator > 0) await ensureFolder(app, filePath.slice(0, separator));
}
async function ensureFolder(app, folderPath) {
  const parts = (0, import_obsidian3.normalizePath)(folderPath).split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const existing = app.vault.getAbstractFileByPath(current);
    if (existing instanceof import_obsidian3.TFolder) continue;
    if (existing) throw new Error(`\u65E0\u6CD5\u521B\u5EFA\u6587\u4EF6\u5939\uFF0C\u8DEF\u5F84\u5DF2\u88AB\u6587\u4EF6\u5360\u7528\uFF1A${current}`);
    await app.vault.createFolder(current);
  }
}

// src/main.ts
var TOKEN_SECRET_ID = "mubu-sync-jwt-token";
var DEFAULT_SETTINGS = {
  syncFolder: "Mubu",
  autoSyncOnStartup: false,
  autoSyncIntervalMinutes: 60,
  deleteBehavior: "archive",
  ignoreCompletionStatus: false,
  debugSaveRawResponses: false,
  lastSyncTime: 0,
  syncedDocuments: {}
};
var MubuSyncPlugin = class extends import_obsidian4.Plugin {
  constructor() {
    super(...arguments);
    this.settings = { ...DEFAULT_SETTINGS, syncedDocuments: {} };
    this.intervalId = null;
    this.syncing = false;
    this.settingsTab = null;
  }
  async onload() {
    await this.loadSettings();
    this.addRibbonIcon("refresh-cw", "\u540C\u6B65\u5E55\u5E03", () => {
      void this.runSync();
    });
    this.addCommand({
      id: "sync-now",
      name: "\u7ACB\u5373\u540C\u6B65\u5E55\u5E03",
      callback: () => void this.runSync()
    });
    this.addCommand({
      id: "login",
      name: "\u767B\u5F55\u5E55\u5E03",
      callback: () => void this.login()
    });
    this.addCommand({
      id: "force-resync",
      name: "\u91CD\u65B0\u540C\u6B65\u6240\u6709\u5E55\u5E03\u6587\u6863",
      callback: () => void this.forceResync()
    });
    this.settingsTab = new MubuSyncSettingTab(this.app, this);
    this.addSettingTab(this.settingsTab);
    this.restartInterval();
    if (this.settings.autoSyncOnStartup && this.getJwtToken()) {
      window.setTimeout(() => void this.runSync(), 3e3);
    }
  }
  onunload() {
    this.stopInterval();
  }
  async login() {
    try {
      new import_obsidian4.Notice("\u8BF7\u5728\u5F39\u51FA\u7684\u7A97\u53E3\u4E2D\u767B\u5F55\u5E55\u5E03\u2026");
      const token = await loginToMubu(async (candidate) => {
        await new MubuClient(candidate).verifyAuthentication();
      });
      if (!token) {
        new import_obsidian4.Notice("\u5E55\u5E03\u767B\u5F55\u5DF2\u53D6\u6D88");
        return;
      }
      this.setJwtToken(token);
      await this.saveSettings();
      this.restartInterval();
      this.settingsTab?.display();
      new import_obsidian4.Notice("\u5E55\u5E03\u767B\u5F55\u6210\u529F\uFF0C\u5F00\u59CB\u9996\u6B21\u540C\u6B65");
      await this.runSync();
    } catch (error) {
      console.error("[Mubu Sync] Login failed", error);
      new import_obsidian4.Notice(`\u5E55\u5E03\u767B\u5F55\u5931\u8D25\uFF1A${errorMessage2(error)}`);
    }
  }
  async runSync() {
    if (this.syncing) {
      new import_obsidian4.Notice("\u5E55\u5E03\u540C\u6B65\u6B63\u5728\u8FDB\u884C\u4E2D");
      return;
    }
    const jwtToken = this.getJwtToken();
    if (!jwtToken) {
      new import_obsidian4.Notice("\u8BF7\u5148\u5728 Mubu Sync \u8BBE\u7F6E\u4E2D\u767B\u5F55\u5E55\u5E03");
      return;
    }
    this.syncing = true;
    new import_obsidian4.Notice("\u5E55\u5E03\uFF1A\u6B63\u5728\u540C\u6B65\u2026");
    try {
      const engine = new MubuSyncEngine({
        app: this.app,
        jwtToken,
        settings: this.settings,
        saveProgress: () => this.saveSettings()
      });
      const result = await engine.run();
      new import_obsidian4.Notice(formatSyncResult(result), 8e3);
    } catch (error) {
      console.error("[Mubu Sync] Sync failed", error);
      if (error instanceof MubuApiError && error.isAuthenticationError) {
        new import_obsidian4.Notice("\u5E55\u5E03\u767B\u5F55\u5DF2\u5931\u6548\uFF0C\u8BF7\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u91CD\u65B0\u767B\u5F55", 8e3);
      } else {
        new import_obsidian4.Notice(`\u5E55\u5E03\u540C\u6B65\u5931\u8D25\uFF1A${errorMessage2(error)}`, 8e3);
      }
    } finally {
      this.syncing = false;
      this.settingsTab?.display();
    }
  }
  async forceResync() {
    for (const record of Object.values(this.settings.syncedDocuments)) {
      record.remoteHash = "";
    }
    await this.saveSettings();
    new import_obsidian4.Notice("\u5E55\u5E03\u540C\u6B65\u8BB0\u5F55\u5DF2\u91CD\u7F6E\uFF0C\u5F00\u59CB\u91CD\u65B0\u540C\u6B65");
    await this.runSync();
  }
  async verifySavedToken() {
    const token = this.getJwtToken();
    if (!token) return false;
    try {
      await new MubuClient(token).verifyAuthentication();
      new import_obsidian4.Notice("\u5E55\u5E03\u767B\u5F55\u72B6\u6001\u6709\u6548");
      return true;
    } catch (error) {
      new import_obsidian4.Notice(`\u5E55\u5E03\u767B\u5F55\u9A8C\u8BC1\u5931\u8D25\uFF1A${errorMessage2(error)}`);
      return false;
    }
  }
  restartInterval() {
    this.stopInterval();
    if (!this.getJwtToken() || this.settings.autoSyncIntervalMinutes <= 0) return;
    const milliseconds = this.settings.autoSyncIntervalMinutes * 60 * 1e3;
    this.intervalId = window.setInterval(() => void this.runSync(), milliseconds);
    this.registerInterval(this.intervalId);
  }
  async loadSettings() {
    const loaded = await this.loadData();
    const legacyToken = loaded?.jwtToken?.trim() || "";
    const safeLoaded = { ...loaded ?? {} };
    delete safeLoaded.jwtToken;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...safeLoaded,
      syncedDocuments: loaded?.syncedDocuments ?? {},
      ignoreCompletionStatus: loaded?.ignoreCompletionStatus === true,
      debugSaveRawResponses: loaded?.debugSaveRawResponses === true
    };
    if (legacyToken && !this.getJwtToken()) {
      this.setJwtToken(legacyToken);
    }
    if (loaded && Object.prototype.hasOwnProperty.call(loaded, "jwtToken")) {
      await this.saveSettings();
    }
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  getJwtToken() {
    return this.app.secretStorage.getSecret(TOKEN_SECRET_ID)?.trim() || "";
  }
  setJwtToken(token) {
    this.app.secretStorage.setSecret(TOKEN_SECRET_ID, token.trim());
  }
  async clearLogin() {
    this.setJwtToken("");
    await clearMubuLoginSession();
    await this.saveSettings();
    this.restartInterval();
  }
  stopInterval() {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
};
var MubuSyncSettingTab = class extends import_obsidian4.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    const connected = Boolean(this.plugin.getJwtToken());
    containerEl.createDiv({
      cls: `mubu-sync-login-status ${connected ? "is-connected" : "is-disconnected"}`,
      text: connected ? "\u25CF \u5DF2\u4FDD\u5B58\u5E55\u5E03\u767B\u5F55\u51ED\u8BC1" : "\u25CB \u5C1A\u672A\u767B\u5F55\u5E55\u5E03"
    });
    if (import_obsidian4.Platform.isDesktop) {
      new import_obsidian4.Setting(containerEl).setName("\u767B\u5F55\u5E55\u5E03").setDesc("\u6253\u5F00\u72EC\u7ACB\u7684\u5E55\u5E03\u767B\u5F55\u7A97\u53E3\uFF0C\u767B\u5F55\u6210\u529F\u540E\u81EA\u52A8\u83B7\u53D6\u51ED\u8BC1").addButton((button) => button.setButtonText(connected ? "\u91CD\u65B0\u767B\u5F55" : "\u767B\u5F55").setCta().onClick(() => void this.plugin.login()));
    }
    let manualTokenDraft = "";
    new import_obsidian4.Setting(containerEl).setName("\u624B\u52A8 Token").setDesc("\u81EA\u52A8\u767B\u5F55\u4E0D\u53EF\u7528\u65F6\uFF0C\u53EF\u624B\u52A8\u586B\u5199 Jwt-Token\uFF1B\u51ED\u8BC1\u7531 Obsidian SecretStorage \u4FDD\u5B58").addText((text) => {
      text.inputEl.type = "password";
      text.setPlaceholder("Jwt-Token").onChange((value) => {
        manualTokenDraft = value.trim();
      });
    }).addButton((button) => button.setButtonText("\u4FDD\u5B58").onClick(async () => {
      if (!manualTokenDraft) {
        new import_obsidian4.Notice("\u8BF7\u8F93\u5165 Jwt-Token");
        return;
      }
      this.plugin.setJwtToken(manualTokenDraft);
      await this.plugin.saveSettings();
      this.plugin.restartInterval();
      new import_obsidian4.Notice("\u5E55\u5E03 Token \u5DF2\u4FDD\u5B58\u5230 SecretStorage");
      this.display();
    })).addButton((button) => button.setButtonText("\u9A8C\u8BC1").onClick(() => void this.plugin.verifySavedToken())).addButton((button) => button.setButtonText("\u6E05\u9664").onClick(async () => {
      await this.plugin.clearLogin();
      new import_obsidian4.Notice("\u5E55\u5E03\u767B\u5F55\u51ED\u8BC1\u548C\u767B\u5F55\u4F1A\u8BDD\u5DF2\u6E05\u9664");
      this.display();
    }));
    new import_obsidian4.Setting(containerEl).setName("\u540C\u6B65\u76EE\u5F55").setDesc("\u5E55\u5E03\u6587\u6863\u5199\u5165\u7684 Obsidian \u4ED3\u5E93\u76EE\u5F55").addText((text) => text.setPlaceholder("Mubu").setValue(this.plugin.settings.syncFolder).onChange(async (value) => {
      this.plugin.settings.syncFolder = value.trim() || "Mubu";
      await this.plugin.saveSettings();
    }));
    new import_obsidian4.Setting(containerEl).setName("\u542F\u52A8\u65F6\u540C\u6B65").setDesc("\u6253\u5F00 Obsidian \u540E\u81EA\u52A8\u540C\u6B65\u4E00\u6B21").addToggle((toggle) => toggle.setValue(this.plugin.settings.autoSyncOnStartup).onChange(async (value) => {
      this.plugin.settings.autoSyncOnStartup = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian4.Setting(containerEl).setName("\u81EA\u52A8\u540C\u6B65\u95F4\u9694").setDesc("\u4EC5\u5728 Obsidian \u684C\u9762\u7248\u8FD0\u884C\u671F\u95F4\u751F\u6548").addDropdown((dropdown) => dropdown.addOption("0", "\u5173\u95ED").addOption("15", "\u6BCF 15 \u5206\u949F").addOption("30", "\u6BCF 30 \u5206\u949F").addOption("60", "\u6BCF\u5C0F\u65F6").addOption("180", "\u6BCF 3 \u5C0F\u65F6").addOption("360", "\u6BCF 6 \u5C0F\u65F6").setValue(String(this.plugin.settings.autoSyncIntervalMinutes)).onChange(async (value) => {
      this.plugin.settings.autoSyncIntervalMinutes = Number(value);
      await this.plugin.saveSettings();
      this.plugin.restartInterval();
    }));
    new import_obsidian4.Setting(containerEl).setName("\u5E55\u5E03\u4E2D\u5220\u9664\u7684\u6587\u6863").setDesc("\u5F52\u6863\u4F1A\u5C06\u5BF9\u5E94\u6587\u4EF6\u79FB\u52A8\u5230\u540C\u6B65\u76EE\u5F55\u7684 _mubu_deleted \u6587\u4EF6\u5939").addDropdown((dropdown) => dropdown.addOption("archive", "\u5F52\u6863\uFF08\u63A8\u8350\uFF09").addOption("keep", "\u4FDD\u7559\u539F\u6587\u4EF6").setValue(this.plugin.settings.deleteBehavior).onChange(async (value) => {
      this.plugin.settings.deleteBehavior = value === "keep" ? "keep" : "archive";
      await this.plugin.saveSettings();
    }));
    new import_obsidian4.Setting(containerEl).setName("\u5FFD\u7565\u5E55\u5E03\u5B8C\u6210\u72B6\u6001").setDesc("\u5C06\u6240\u6709\u8282\u70B9\u4F5C\u4E3A\u666E\u901A\u6587\u672C\u540C\u6B65\uFF0C\u4E0D\u8F93\u51FA\u4EFB\u52A1\u590D\u9009\u6846\uFF08\u7528\u4E8E\u6392\u67E5\u5F02\u5E38\u8282\u70B9\uFF09").addToggle((toggle) => toggle.setValue(this.plugin.settings.ignoreCompletionStatus).onChange(async (value) => {
      this.plugin.settings.ignoreCompletionStatus = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian4.Setting(containerEl).setName("\u4FDD\u5B58\u539F\u59CB API \u54CD\u5E94").setDesc("\u8C03\u8BD5\u7528\uFF1A\u5C06\u6587\u6863\u8BE6\u60C5 JSON \u4FDD\u5B58\u5230 .mubu-sync-debug\uFF0C\u8BF7\u52FF\u957F\u671F\u5F00\u542F").addToggle((toggle) => toggle.setValue(this.plugin.settings.debugSaveRawResponses).onChange(async (value) => {
      this.plugin.settings.debugSaveRawResponses = value;
      await this.plugin.saveSettings();
    }));
    const actions = containerEl.createDiv({ cls: "mubu-sync-settings-actions" });
    const syncButton = actions.createEl("button", { text: "\u7ACB\u5373\u540C\u6B65" });
    syncButton.addEventListener("click", () => void this.plugin.runSync());
    const resetButton = actions.createEl("button", { text: "\u91CD\u65B0\u540C\u6B65\u5168\u90E8" });
    resetButton.addEventListener("click", () => void this.plugin.forceResync());
    const lastSync = this.plugin.settings.lastSyncTime ? new Date(this.plugin.settings.lastSyncTime).toLocaleString() : "\u5C1A\u672A\u5B8C\u6210\u540C\u6B65";
    containerEl.createEl("p", {
      cls: "mubu-sync-settings-note",
      text: `\u4E0A\u6B21\u540C\u6B65\uFF1A${lastSync}\uFF1B\u5DF2\u8DDF\u8E2A ${Object.keys(this.plugin.settings.syncedDocuments).length} \u7BC7\u6587\u6863\u3002`
    });
    containerEl.createEl("p", {
      cls: "mubu-sync-settings-note",
      text: "\u8FD9\u662F\u5355\u5411\u540C\u6B65\uFF1A\u5E55\u5E03\u5185\u5BB9\u4F1A\u66F4\u65B0\u6807\u8BB0\u533A\u95F4\uFF0C\u6587\u4EF6\u4E2D\u7684\u201C\u6211\u7684\u8865\u5145\u201D\u90E8\u5206\u4F1A\u88AB\u4FDD\u7559\u3002"
    });
  }
};
function formatSyncResult(result) {
  const changed = [
    result.created ? `\u65B0\u589E ${result.created}` : "",
    result.updated ? `\u66F4\u65B0 ${result.updated}` : "",
    result.moved ? `\u79FB\u52A8 ${result.moved}` : "",
    result.archived ? `\u5F52\u6863 ${result.archived}` : "",
    result.failed ? `\u5931\u8D25 ${result.failed}` : ""
  ].filter(Boolean);
  return changed.length > 0 ? `\u5E55\u5E03\u540C\u6B65\u5B8C\u6210\uFF1A${changed.join("\uFF0C")}\uFF08\u5171 ${result.total} \u7BC7\uFF09` : `\u5E55\u5E03\uFF1A${result.total} \u7BC7\u6587\u6863\u5747\u5DF2\u662F\u6700\u65B0\u72B6\u6001 \u2713`;
}
function errorMessage2(error) {
  return error instanceof Error ? error.message : String(error);
}
