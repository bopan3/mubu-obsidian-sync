export interface MubuFolder {
  id: string;
  name?: string;
  folderId?: string;
  folder_id?: string;
}

export interface MubuDocumentSummary {
  id: string;
  title: string;
  folderId: string;
  folderPath: string;
  type?: string | number;
  revisionHint?: string;
}

export interface MubuImage {
  uri?: string;
  url?: string;
  alt?: string;
  name?: string;
  width?: number;
  w?: number;
}

export interface MubuNode {
  id?: string;
  text?: string;
  note?: string;
  heading?: number;
  collapsed?: boolean;
  completed?: boolean;
  finish?: boolean;
  taskStatus?: number;
  deadline?: number;
  emoji?: string;
  image?: MubuImage;
  images?: MubuImage[];
  imageList?: MubuImage[];
  children?: MubuNode[];
}

export interface MubuDefinition {
  nodes?: MubuNode[];
  viewType?: string;
  [key: string]: unknown;
}

export interface MubuDocumentDetail {
  id: string;
  title: string;
  definition: MubuDefinition;
  baseVersion?: string;
  raw?: unknown;
}

export interface SyncedDocumentRecord {
  title: string;
  folderId: string;
  remoteHash: string;
  remoteRevision?: string;
  filePath: string;
  syncedAt: number;
}

export type DeleteBehavior = "archive" | "keep";

export interface MubuSyncSettings {
  syncFolder: string;
  autoSyncOnStartup: boolean;
  autoSyncIntervalMinutes: number;
  deleteBehavior: DeleteBehavior;
  lastSyncTime: number;
  syncedDocuments: Record<string, SyncedDocumentRecord>;
  ignoreCompletionStatus: boolean;
  debugSaveRawResponses: boolean;
}

export interface LegacyMubuSyncSettings extends Partial<MubuSyncSettings> {
  jwtToken?: string;
}

export interface SyncResult {
  total: number;
  created: number;
  updated: number;
  moved: number;
  archived: number;
  unchanged: number;
  failed: number;
}
