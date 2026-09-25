import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  createInitialFile,
  htmlToMarkdown,
  renderMubuDocument,
  replaceManagedBlock
} from "../src/markdown";
import type { MubuDocumentSummary } from "../src/types";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
Object.assign(globalThis, {
  DOMParser: dom.window.DOMParser,
  Node: dom.window.Node,
  HTMLElement: dom.window.HTMLElement
});

const summary: MubuDocumentSummary = {
  id: "doc-123",
  title: "测试文档",
  folderId: "folder-1",
  folderPath: "工作/项目"
};

test("converts representative Mubu rich text to Markdown", () => {
  const markdown = htmlToMarkdown([
    '<span class="bold">加粗</span>',
    '<span class="formula" data-raw="x%5E2%2By%5E2"></span>',
    "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>"
  ].join(""));

  assert.match(markdown, /\*\*加粗\*\*/);
  assert.match(markdown, /\$x\^2\+y\^2\$/);
  assert.match(markdown, /\| A \| B \|/);
  assert.match(markdown, /\| 1 \| 2 \|/);
});

test("renders nested nodes, tasks, notes and deadlines", () => {
  const managed = renderMubuDocument(summary, [{
    text: "父节点",
    taskStatus: 1,
    deadline: 1_787_059_200,
    note: "<strong>备注</strong>",
    children: [{ text: "子节点", completed: true }]
  }]);

  assert.match(managed, /- \[ \] 父节点/);
  assert.match(managed, /> \*\*备注\*\*/);
  assert.match(managed, /  - \[x\] 子节点/);
  assert.match(managed, /📅 2026-/);
});

test("does not infer a task from missing or string-like completion fields", () => {
  const managed = renderMubuDocument(summary, [
    { text: "普通文本" },
    { text: "字符串零", taskStatus: "0" as unknown as number },
    { text: "字符串假", completed: "false" as unknown as boolean },
    { text: "布尔未完成", completed: false },
    { text: "颜色高亮", textStyle: "red" as unknown as string, note: '<span class="highlight-yellow"><span class="bold">重点</span></span>' }
  ]);

  assert.match(managed, /- 普通文本/);
  assert.match(managed, /- 字符串零/);
  assert.match(managed, /- 字符串假/);
  assert.match(managed, /> ==\*\*重点\*\*==/);
  assert.doesNotMatch(managed, /\[x\]|\[ \]|~~/);
});

test("can ignore completion status as a defensive fallback", () => {
  const managed = renderMubuDocument(summary, [{ text: "已完成", taskStatus: 0 }], {
    ignoreCompletionStatus: true
  });
  assert.match(managed, /- 已完成/);
  assert.doesNotMatch(managed, /\[x\]/);
});

test("does not treat an isolated Mubu taskStatus zero as a completed task", () => {
  const managed = renderMubuDocument(summary, [{
    id: "qZsRT3WSrR",
    taskStatus: 0,
    text: "<span>4. undue influence 翻译：不当影响</span>"
  }]);
  assert.match(managed, /- 4\. undue influence 翻译：不当影响/);
  assert.doesNotMatch(managed, /\[x\]/);
});

test("only explicit strike markup renders as strikethrough", () => {
  assert.equal(htmlToMarkdown('<span style="color:red">红色</span><mark>高亮</mark>'), "红色==高亮==");
  assert.equal(htmlToMarkdown('<s>明确删除线</s>'), "~~明确删除线~~");
});

test("does not double-wrap heading text that is already bold", () => {
  const managed = renderMubuDocument(summary, [{
    text: '<span class="bold">标题</span>',
    heading: 1
  }]);

  assert.match(managed, /- \*\*标题\*\*/);
  assert.doesNotMatch(managed, /\*\*\*\*标题\*\*\*\*/);
});

test("does not wrap a heading around existing inline bold fragments", () => {
  const managed = renderMubuDocument(summary, [{
    text: '前缀<span class="bold">加粗结尾</span>',
    heading: 1
  }]);

  assert.match(managed, /- 前缀\*\*加粗结尾\*\*/);
  assert.doesNotMatch(managed, /\*{4,}/);
});

test("collapses duplicate bold markers from nested rich-text spans", () => {
  const markdown = htmlToMarkdown('<span class="bold"><strong>嵌套加粗</strong></span>');
  assert.equal(markdown, "**嵌套加粗**");
});

test("updates only the managed block and preserves local notes", () => {
  const originalManaged = renderMubuDocument(summary, [{ text: "旧内容" }]);
  const initial = `${createInitialFile(summary, originalManaged)}本地内容\n`;
  const nextManaged = renderMubuDocument(summary, [{ text: "新内容" }]);
  const updated = replaceManagedBlock(initial, nextManaged);

  assert.ok(updated);
  assert.doesNotMatch(updated, /旧内容/);
  assert.match(updated, /新内容/);
  assert.match(updated, /本地内容/);
});

test("refuses to overwrite files whose management markers were removed", () => {
  const managed = renderMubuDocument(summary, [{ text: "内容" }]);
  assert.equal(replaceManagedBlock("用户自己的文件", managed), null);
});
