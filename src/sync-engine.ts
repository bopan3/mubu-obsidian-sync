import { createHash } from "crypto";
import { App, normalizePath, TFile, TFolder } from "obsidian";
import { MubuApiError, MubuClient, sanitizePathPart } from "./mubu-api";
import { createInitialFile, renderMubuDocument, replaceManagedBlock } from "./markdown";
import type {
  MubuDocumentSummary,
  MubuSyncSettings,
  SyncResult,
  SyncedDocumentRecord
} from "./types";

export interface SyncEngineOptions {
  app: App;
  jwtToken: string;
  settings: MubuSyncSettings;
  saveProgress: () => Promise<void>;
}

export class MubuSyncEngine {
  private readonly app: App;
  private readonly jwtToken: string;
  private readonly settings: MubuSyncSettings;
  private readonly saveProgress: () => Promise<void>;

  constructor(options: SyncEngineOptions) {
    this.app = options.app;
    this.jwtToken = options.jwtToken;
    this.settings = options.settings;
    this.saveProgress = options.saveProgress;
  }

  async run(): Promise<SyncResult> {
    const client = new MubuClient(this.jwtToken);
    const catalog = await client.fetchCatalog();
    const syncRoot = normalizeSyncRoot(this.settings.syncFolder);
    await ensureFolder(this.app, syncRoot);

    const result: SyncResult = {
      total: catalog.length,
      created: 0,
      updated: 0,
      moved: 0,
      archived: 0,
      unchanged: 0,
      failed: 0
    };

    const activeIds = new Set(catalog.map(document => document.id));
    const collisions = countRemotePathCollisions(catalog, syncRoot);

    for (const summary of catalog) {
      try {
        const detail = await client.fetchDocument(summary);
        const normalizedSummary: MubuDocumentSummary = {
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

        if (this.settings.debugSaveRawResponses && detail.raw !== undefined) {
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

  private async syncDocument(
    summary: MubuDocumentSummary,
    remoteHash: string,
    managedBlock: string,
    collisions: Map<string, number>,
    result: SyncResult
  ): Promise<void> {
    const record = this.settings.syncedDocuments[summary.id];
    const preferredPath = buildPreferredPath(summary, normalizeSyncRoot(this.settings.syncFolder), collisions);
    const oldFile = record ? getFile(this.app, record.filePath) : null;
    const targetPath = await findAvailablePath(this.app, preferredPath, summary.id, oldFile?.path);
    const remoteChanged = !record
      || record.remoteHash !== remoteHash
      || record.title !== summary.title;

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
        throw new Error(`目标文件已存在且不属于当前幕布文档：${targetPath}`);
      }
      file = await this.app.vault.create(targetPath, createInitialFile(summary, managedBlock));
      result.created += 1;
    } else if (remoteChanged) {
      const filePath = file.path;
      await this.app.vault.process(file, existingContent => {
        const merged = replaceManagedBlock(existingContent, managedBlock);
        if (merged === null) {
          throw new Error(`同步标记已被移除，为避免覆盖本地内容已跳过：${filePath}`);
        }
        return merged;
      });
      result.updated += 1;
    } else {
      result.unchanged += 1;
    }

    const syncedRecord: SyncedDocumentRecord = {
      title: summary.title,
      folderId: summary.folderId,
      remoteHash,
      remoteRevision: summary.revisionHint,
      filePath: file.path,
      syncedAt: Date.now()
    };
    this.settings.syncedDocuments[summary.id] = syncedRecord;
  }

  private async archiveMissingDocuments(
    activeIds: Set<string>,
    syncRoot: string,
    result: SyncResult
  ): Promise<void> {
    const date = new Date();
    const dateFolder = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");

    for (const [documentId, record] of Object.entries(this.settings.syncedDocuments)) {
      if (activeIds.has(documentId)) continue;

      const file = getFile(this.app, record.filePath);
      if (file) {
        const relative = record.filePath.startsWith(`${syncRoot}/`)
          ? record.filePath.slice(syncRoot.length + 1)
          : record.filePath.split("/").pop() || `${documentId}.md`;
        const preferredArchivePath = normalizePath(`${syncRoot}/_mubu_deleted/${dateFolder}/${relative}`);
        const archivePath = await findAvailablePath(this.app, preferredArchivePath, documentId);
        await ensureParentFolder(this.app, archivePath);
        await this.app.fileManager.renameFile(file, archivePath);
        result.archived += 1;
      }

      delete this.settings.syncedDocuments[documentId];
      await this.saveProgress();
    }
  }
}

async function saveDebugResponse(app: App, documentId: string, payload: unknown): Promise<void> {
  const folder = ".mubu-sync-debug";
  await ensureFolder(app, folder);
  const safeId = sanitizePathPart(documentId, "document");
  await app.vault.create(normalizePath(`${folder}/${Date.now()}-${safeId}.json`), `${JSON.stringify(payload, null, 2)}\n`);
}

function countRemotePathCollisions(
  catalog: MubuDocumentSummary[],
  syncRoot: string
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const summary of catalog) {
    const path = rawPreferredPath(summary, syncRoot);
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return counts;
}

function buildPreferredPath(
  summary: MubuDocumentSummary,
  syncRoot: string,
  collisions: Map<string, number>
): string {
  const raw = rawPreferredPath(summary, syncRoot);
  if ((collisions.get(raw) ?? 0) <= 1) return raw;
  return withIdSuffix(raw, summary.id);
}

function rawPreferredPath(summary: MubuDocumentSummary, syncRoot: string): string {
  const folder = summary.folderPath
    .split("/")
    .filter(Boolean)
    .map(part => sanitizePathPart(part))
    .join("/");
  const title = sanitizePathPart(summary.title, summary.id);
  return normalizePath([syncRoot, folder, `${title}.md`].filter(Boolean).join("/"));
}

async function findAvailablePath(
  app: App,
  preferredPath: string,
  documentId: string,
  currentPath?: string
): Promise<string> {
  const normalized = normalizePath(preferredPath);
  const existing = app.vault.getAbstractFileByPath(normalized);
  if (!existing || normalized === currentPath) return normalized;

  const suffixed = withIdSuffix(normalized, documentId);
  const suffixedExisting = app.vault.getAbstractFileByPath(suffixed);
  if (!suffixedExisting || suffixed === currentPath) return suffixed;

  for (let index = 2; index < 1_000; index += 1) {
    const candidate = suffixed.replace(/\.md$/i, `-${index}.md`);
    const candidateExisting = app.vault.getAbstractFileByPath(candidate);
    if (!candidateExisting || candidate === currentPath) return candidate;
  }

  throw new Error(`无法为幕布文档分配文件名：${preferredPath}`);
}

function withIdSuffix(path: string, documentId: string): string {
  const suffix = sanitizePathPart(documentId.slice(-8), "document");
  return path.replace(/\.md$/i, `~${suffix}.md`);
}

function hashDefinition(definition: unknown): string {
  return createHash("sha256").update(JSON.stringify(definition)).digest("hex");
}

function normalizeSyncRoot(value: string): string {
  const path = value
    .split("/")
    .filter(Boolean)
    .map(part => sanitizePathPart(part))
    .join("/");
  return normalizePath(path || "Mubu");
}

function getFile(app: App, path: string): TFile | null {
  const item = app.vault.getAbstractFileByPath(normalizePath(path));
  return item instanceof TFile ? item : null;
}

async function ensureParentFolder(app: App, filePath: string): Promise<void> {
  const separator = filePath.lastIndexOf("/");
  if (separator > 0) await ensureFolder(app, filePath.slice(0, separator));
}

async function ensureFolder(app: App, folderPath: string): Promise<void> {
  const parts = normalizePath(folderPath).split("/").filter(Boolean);
  let current = "";

  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const existing = app.vault.getAbstractFileByPath(current);
    if (existing instanceof TFolder) continue;
    if (existing) throw new Error(`无法创建文件夹，路径已被文件占用：${current}`);
    await app.vault.createFolder(current);
  }
}
