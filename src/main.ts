import {
  App,
  Notice,
  Platform,
  Plugin,
  PluginSettingTab,
  Setting
} from "obsidian";
import { clearMubuLoginSession, loginToMubu } from "./auth";
import { MubuApiError, MubuClient } from "./mubu-api";
import { MubuSyncEngine } from "./sync-engine";
import type { LegacyMubuSyncSettings, MubuSyncSettings, SyncResult } from "./types";

const TOKEN_SECRET_ID = "mubu-sync-jwt-token";

const DEFAULT_SETTINGS: MubuSyncSettings = {
  syncFolder: "Mubu",
  autoSyncOnStartup: false,
  autoSyncIntervalMinutes: 60,
  deleteBehavior: "archive",
  ignoreCompletionStatus: false,
  debugSaveRawResponses: false,
  lastSyncTime: 0,
  syncedDocuments: {}
};

export default class MubuSyncPlugin extends Plugin {
  settings: MubuSyncSettings = { ...DEFAULT_SETTINGS, syncedDocuments: {} };
  private intervalId: number | null = null;
  private syncing = false;
  private settingsTab: MubuSyncSettingTab | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addRibbonIcon("refresh-cw", "同步幕布", () => {
      void this.runSync();
    });

    this.addCommand({
      id: "sync-now",
      name: "立即同步幕布",
      callback: () => void this.runSync()
    });

    this.addCommand({
      id: "login",
      name: "登录幕布",
      callback: () => void this.login()
    });

    this.addCommand({
      id: "force-resync",
      name: "重新同步所有幕布文档",
      callback: () => void this.forceResync()
    });

    this.settingsTab = new MubuSyncSettingTab(this.app, this);
    this.addSettingTab(this.settingsTab);

    this.restartInterval();

    if (this.settings.autoSyncOnStartup && this.getJwtToken()) {
      window.setTimeout(() => void this.runSync(), 3_000);
    }
  }

  onunload(): void {
    this.stopInterval();
  }

  async login(): Promise<void> {
    try {
      new Notice("请在弹出的窗口中登录幕布…");
      const token = await loginToMubu(async candidate => {
        await new MubuClient(candidate).verifyAuthentication();
      });

      if (!token) {
        new Notice("幕布登录已取消");
        return;
      }

      this.setJwtToken(token);
      await this.saveSettings();
      this.restartInterval();
      this.settingsTab?.display();
      new Notice("幕布登录成功，开始首次同步");
      await this.runSync();
    } catch (error) {
      console.error("[Mubu Sync] Login failed", error);
      new Notice(`幕布登录失败：${errorMessage(error)}`);
    }
  }

  async runSync(): Promise<void> {
    if (this.syncing) {
      new Notice("幕布同步正在进行中");
      return;
    }
    const jwtToken = this.getJwtToken();
    if (!jwtToken) {
      new Notice("请先在 Mubu Sync 设置中登录幕布");
      return;
    }

    this.syncing = true;
    new Notice("幕布：正在同步…");

    try {
      const engine = new MubuSyncEngine({
        app: this.app,
        jwtToken,
        settings: this.settings,
        saveProgress: () => this.saveSettings()
      });
      const result = await engine.run();
      new Notice(formatSyncResult(result), 8_000);
    } catch (error) {
      console.error("[Mubu Sync] Sync failed", error);
      if (error instanceof MubuApiError && error.isAuthenticationError) {
        new Notice("幕布登录已失效，请在插件设置中重新登录", 8_000);
      } else {
        new Notice(`幕布同步失败：${errorMessage(error)}`, 8_000);
      }
    } finally {
      this.syncing = false;
      this.settingsTab?.display();
    }
  }

  async forceResync(): Promise<void> {
    for (const record of Object.values(this.settings.syncedDocuments)) {
      record.remoteHash = "";
    }
    await this.saveSettings();
    new Notice("幕布同步记录已重置，开始重新同步");
    await this.runSync();
  }

  async verifySavedToken(): Promise<boolean> {
    const token = this.getJwtToken();
    if (!token) return false;
    try {
      await new MubuClient(token).verifyAuthentication();
      new Notice("幕布登录状态有效");
      return true;
    } catch (error) {
      new Notice(`幕布登录验证失败：${errorMessage(error)}`);
      return false;
    }
  }

  restartInterval(): void {
    this.stopInterval();
    if (!this.getJwtToken() || this.settings.autoSyncIntervalMinutes <= 0) return;

    const milliseconds = this.settings.autoSyncIntervalMinutes * 60 * 1_000;
    this.intervalId = window.setInterval(() => void this.runSync(), milliseconds);
    this.registerInterval(this.intervalId);
  }

  async loadSettings(): Promise<void> {
    const loaded = await this.loadData() as LegacyMubuSyncSettings | null;
    const legacyToken = loaded?.jwtToken?.trim() || "";
    const safeLoaded = { ...(loaded ?? {}) };
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

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  getJwtToken(): string {
    return this.app.secretStorage.getSecret(TOKEN_SECRET_ID)?.trim() || "";
  }

  setJwtToken(token: string): void {
    this.app.secretStorage.setSecret(TOKEN_SECRET_ID, token.trim());
  }

  async clearLogin(): Promise<void> {
    this.setJwtToken("");
    await clearMubuLoginSession();
    await this.saveSettings();
    this.restartInterval();
  }

  private stopInterval(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

class MubuSyncSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: MubuSyncPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const connected = Boolean(this.plugin.getJwtToken());
    containerEl.createDiv({
      cls: `mubu-sync-login-status ${connected ? "is-connected" : "is-disconnected"}`,
      text: connected ? "● 已保存幕布登录凭证" : "○ 尚未登录幕布"
    });

    if (Platform.isDesktop) {
      new Setting(containerEl)
        .setName("登录幕布")
        .setDesc("打开独立的幕布登录窗口，登录成功后自动获取凭证")
        .addButton(button => button
          .setButtonText(connected ? "重新登录" : "登录")
          .setCta()
          .onClick(() => void this.plugin.login()));
    }

    let manualTokenDraft = "";
    new Setting(containerEl)
      .setName("手动 Token")
      .setDesc("自动登录不可用时，可手动填写 Jwt-Token；凭证由 Obsidian SecretStorage 保存")
      .addText(text => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("Jwt-Token")
          .onChange(value => {
            manualTokenDraft = value.trim();
          });
      })
      .addButton(button => button
        .setButtonText("保存")
        .onClick(async () => {
          if (!manualTokenDraft) {
            new Notice("请输入 Jwt-Token");
            return;
          }
          this.plugin.setJwtToken(manualTokenDraft);
          await this.plugin.saveSettings();
          this.plugin.restartInterval();
          new Notice("幕布 Token 已保存到 SecretStorage");
          this.display();
        }))
      .addButton(button => button
        .setButtonText("验证")
        .onClick(() => void this.plugin.verifySavedToken()))
      .addButton(button => button
        .setButtonText("清除")
        .onClick(async () => {
          await this.plugin.clearLogin();
          new Notice("幕布登录凭证和登录会话已清除");
          this.display();
        }));

    new Setting(containerEl)
      .setName("同步目录")
      .setDesc("幕布文档写入的 Obsidian 仓库目录")
      .addText(text => text
        .setPlaceholder("Mubu")
        .setValue(this.plugin.settings.syncFolder)
        .onChange(async value => {
          this.plugin.settings.syncFolder = value.trim() || "Mubu";
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("启动时同步")
      .setDesc("打开 Obsidian 后自动同步一次")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoSyncOnStartup)
        .onChange(async value => {
          this.plugin.settings.autoSyncOnStartup = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("自动同步间隔")
      .setDesc("仅在 Obsidian 桌面版运行期间生效")
      .addDropdown(dropdown => dropdown
        .addOption("0", "关闭")
        .addOption("15", "每 15 分钟")
        .addOption("30", "每 30 分钟")
        .addOption("60", "每小时")
        .addOption("180", "每 3 小时")
        .addOption("360", "每 6 小时")
        .setValue(String(this.plugin.settings.autoSyncIntervalMinutes))
        .onChange(async value => {
          this.plugin.settings.autoSyncIntervalMinutes = Number(value);
          await this.plugin.saveSettings();
          this.plugin.restartInterval();
        }));

    new Setting(containerEl)
      .setName("幕布中删除的文档")
      .setDesc("归档会将对应文件移动到同步目录的 _mubu_deleted 文件夹")
      .addDropdown(dropdown => dropdown
        .addOption("archive", "归档（推荐）")
        .addOption("keep", "保留原文件")
        .setValue(this.plugin.settings.deleteBehavior)
        .onChange(async value => {
          this.plugin.settings.deleteBehavior = value === "keep" ? "keep" : "archive";
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("忽略幕布完成状态")
      .setDesc("将所有节点作为普通文本同步，不输出任务复选框（用于排查异常节点）")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.ignoreCompletionStatus)
        .onChange(async value => {
          this.plugin.settings.ignoreCompletionStatus = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("保存原始 API 响应")
      .setDesc("调试用：将文档详情 JSON 保存到 .mubu-sync-debug，请勿长期开启")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.debugSaveRawResponses)
        .onChange(async value => {
          this.plugin.settings.debugSaveRawResponses = value;
          await this.plugin.saveSettings();
        }));

    const actions = containerEl.createDiv({ cls: "mubu-sync-settings-actions" });
    const syncButton = actions.createEl("button", { text: "立即同步" });
    syncButton.addEventListener("click", () => void this.plugin.runSync());
    const resetButton = actions.createEl("button", { text: "重新同步全部" });
    resetButton.addEventListener("click", () => void this.plugin.forceResync());

    const lastSync = this.plugin.settings.lastSyncTime
      ? new Date(this.plugin.settings.lastSyncTime).toLocaleString()
      : "尚未完成同步";
    containerEl.createEl("p", {
      cls: "mubu-sync-settings-note",
      text: `上次同步：${lastSync}；已跟踪 ${Object.keys(this.plugin.settings.syncedDocuments).length} 篇文档。`
    });
    containerEl.createEl("p", {
      cls: "mubu-sync-settings-note",
      text: "这是单向同步：幕布内容会更新标记区间，文件中的“我的补充”部分会被保留。"
    });
  }
}

function formatSyncResult(result: SyncResult): string {
  const changed = [
    result.created ? `新增 ${result.created}` : "",
    result.updated ? `更新 ${result.updated}` : "",
    result.moved ? `移动 ${result.moved}` : "",
    result.archived ? `归档 ${result.archived}` : "",
    result.failed ? `失败 ${result.failed}` : ""
  ].filter(Boolean);

  return changed.length > 0
    ? `幕布同步完成：${changed.join("，")}（共 ${result.total} 篇）`
    : `幕布：${result.total} 篇文档均已是最新状态 ✓`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
