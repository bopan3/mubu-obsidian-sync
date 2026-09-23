import { requestUrl } from "obsidian";
import { isAuthenticationMessage } from "./auth-state";
import type {
  MubuDefinition,
  MubuDocumentDetail,
  MubuDocumentSummary,
  MubuFolder
} from "./types";

const API = {
  documentsPage: "https://api2.mubu.com/v3/api/list/get_all_documents_page",
  list: "https://api2.mubu.com/v3/api/list/get",
  folders: "https://api2.mubu.com/v3/api/list/get_folder",
  documentDetail: "https://api2.mubu.com/v3/api/document/edit/get"
};

interface MubuEnvelope {
  code?: number;
  data?: unknown;
  msg?: string;
  message?: string;
}

type UnknownRecord = Record<string, unknown>;

export class MubuApiError extends Error {
  readonly status?: number;
  readonly code?: number;

  constructor(message: string, options: { status?: number; code?: number } = {}) {
    super(message);
    this.name = "MubuApiError";
    this.status = options.status;
    this.code = options.code;
  }

  get isAuthenticationError(): boolean {
    return this.status === 401
      || this.status === 403
      || isAuthenticationMessage(this.message);
  }
}

export class MubuClient {
  constructor(private readonly jwtToken: string) {}

  async verifyAuthentication(): Promise<void> {
    await this.post(API.folders, {});
  }

  async fetchCatalog(): Promise<MubuDocumentSummary[]> {
    const folders = new Map<string, MubuFolder>();
    const documents = new Map<string, UnknownRecord>();

    await this.fetchPagedDocuments(folders, documents);
    await this.fetchFolderDirectory(folders);
    await this.fetchRecursiveDirectory(folders, documents);

    const folderPaths = buildFolderPaths(folders);
    const result: MubuDocumentSummary[] = [];

    for (const document of documents.values()) {
      const id = stringValue(document.id);
      if (!id) continue;

      const folderId = firstString(document, ["folderId", "folder_id"]);
      result.push({
        id,
        title: firstString(document, ["name", "title"]) || "未命名文档",
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
        ]) || undefined
      });
    }

    return result.sort((a, b) => {
      const pathOrder = a.folderPath.localeCompare(b.folderPath, "zh-CN");
      return pathOrder || a.title.localeCompare(b.title, "zh-CN") || a.id.localeCompare(b.id);
    });
  }

  async fetchDocument(summary: MubuDocumentSummary): Promise<MubuDocumentDetail> {
    const raw = asRecord(await this.post(API.documentDetail, {
      docId: summary.id,
      password: "",
      isFromDocDir: true
    }));

    const definitionRaw = raw.definition;
    let definition: MubuDefinition;

    if (typeof definitionRaw === "string") {
      try {
        definition = JSON.parse(definitionRaw) as MubuDefinition;
      } catch (error) {
        throw new MubuApiError(`文档“${summary.title}”的 definition 无法解析：${errorMessage(error)}`);
      }
    } else if (definitionRaw && typeof definitionRaw === "object") {
      definition = definitionRaw as MubuDefinition;
    } else {
      throw new MubuApiError(`文档“${summary.title}”没有返回 definition`);
    }

    return {
      id: summary.id,
      title: firstString(raw, ["name", "title"]) || summary.title,
      definition,
      baseVersion: firstString(raw, ["baseVersion", "version"]) || undefined,
      raw
    };
  }

  private async fetchPagedDocuments(
    folders: Map<string, MubuFolder>,
    documents: Map<string, UnknownRecord>
  ): Promise<void> {
    let start = "";

    for (let page = 0; page < 100; page += 1) {
      const data = asRecord(await this.post(API.documentsPage, { start }));
      mergeFolders(folders, data.folders);
      mergeDocuments(documents, data.documents);

      const next = firstString(data, ["nextStart", "next_start", "next"]);
      if (!next) return;
      if (next === start) {
        throw new MubuApiError("幕布文档列表分页游标没有前进，已停止同步");
      }
      start = next;
    }

    throw new MubuApiError("幕布文档列表超过 100 页，已停止同步以避免遗漏");
  }

  private async fetchFolderDirectory(folders: Map<string, MubuFolder>): Promise<void> {
    const data = await this.post(API.folders, {});
    mergeFolders(folders, data);
  }

  private async fetchRecursiveDirectory(
    folders: Map<string, MubuFolder>,
    documents: Map<string, UnknownRecord>
  ): Promise<void> {
    const pending = ["0"];
    const visited = new Set<string>();

    while (pending.length > 0) {
      const folderId = pending.shift();
      if (folderId === undefined || visited.has(folderId)) continue;
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

  private async post(url: string, body: UnknownRecord): Promise<unknown> {
    try {
      const response = await requestUrl({
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

      const envelope = response.json as MubuEnvelope;
      if (response.status >= 400) {
        throw new MubuApiError(
          envelope?.msg || envelope?.message || `幕布接口返回 HTTP ${response.status}`,
          { status: response.status, code: envelope?.code }
        );
      }
      if (typeof envelope?.code === "number" && envelope.code !== 0) {
        throw new MubuApiError(
          envelope.msg || envelope.message || `幕布接口返回 code=${envelope.code}`,
          { status: response.status, code: envelope.code }
        );
      }
      return envelope?.data ?? {};
    } catch (error) {
      if (error instanceof MubuApiError) throw error;
      throw new MubuApiError(`幕布网络请求失败：${errorMessage(error)}`);
    }
  }
}

function mergeFolders(target: Map<string, MubuFolder>, input: unknown): void {
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

function mergeDocuments(target: Map<string, UnknownRecord>, input: unknown): void {
  for (const item of arrayValue(input)) {
    const raw = asRecord(item);
    const id = stringValue(raw.id);
    if (id) target.set(id, raw);
  }
}

function buildFolderPaths(folders: Map<string, MubuFolder>): Map<string, string> {
  const paths = new Map<string, string>();

  const visit = (id: string, ancestors: Set<string>): string => {
    if (!id || id === "0") return "";
    const cached = paths.get(id);
    if (cached !== undefined) return cached;
    if (ancestors.has(id)) return "";

    const folder = folders.get(id);
    if (!folder) return "";

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(id);
    const parentId = folder.folderId ?? folder.folder_id ?? "";
    const parent = visit(parentId, nextAncestors);
    const name = sanitizePathPart(folder.name || "未命名文件夹", id);
    const path = parent ? `${parent}/${name}` : name;
    paths.set(id, path);
    return path;
  };

  for (const id of folders.keys()) visit(id, new Set<string>());
  return paths;
}

export function sanitizePathPart(value: string, fallback = "未命名"): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|#^[\]]/g, "-")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  return cleaned || fallback;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function primitiveValue(value: unknown): string | number | undefined {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function firstString(record: UnknownRecord, keys: string[]): string {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) return value;
  }
  return "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
