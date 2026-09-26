import type { MubuDocumentSummary, MubuImage, MubuNode } from "./types";

export const MANAGED_START = "<!-- mubu-sync:start -->";
export const MANAGED_END = "<!-- mubu-sync:end -->";

const IMAGE_HOST = "https://document-image.mubu.com/";

export function renderMubuDocument(
  summary: MubuDocumentSummary,
  nodes: MubuNode[],
  options: { ignoreCompletionStatus?: boolean } = {}
): string {
  const title = summary.title.trim() || "未命名文档";
  const body = renderNodeList(nodes, options);
  return [
    MANAGED_START,
    `# ${escapeMarkdownText(title)}`,
    "",
    body || "_空文档_",
    MANAGED_END
  ].join("\n");
}

export function createInitialFile(summary: MubuDocumentSummary, managedBlock: string): string {
  return [
    "---",
    "source: mubu",
    `mubu_id: ${yamlString(summary.id)}`,
    "---",
    "",
    managedBlock,
    "",
    "## 我的补充",
    "",
    ""
  ].join("\n");
}

export function replaceManagedBlock(existing: string, managedBlock: string): string | null {
  const start = existing.indexOf(MANAGED_START);
  const end = existing.indexOf(MANAGED_END);
  if (start < 0 || end < start) return null;
  return `${existing.slice(0, start)}${managedBlock}${existing.slice(end + MANAGED_END.length)}`;
}

function renderNodeList(nodes: MubuNode[], options: { ignoreCompletionStatus?: boolean }): string {
  const lines: string[] = [];

  const visit = (items: MubuNode[], depth: number): void => {
    for (const node of items) {
      const indent = "  ".repeat(depth);
      const task = !options.ignoreCompletionStatus && isTaskNode(node);
      const bullet = task ? (isCompletedTask(node) ? "- [x] " : "- [ ] ") : "- ";
      let content = htmlToMarkdown(node.text || "").trim();

      if (node.emoji) content = `${node.emoji} ${content}`.trim();
      if (!content) content = "(空)";
      if (node.heading && node.heading > 0 && !content.includes("**")) {
        content = `**${content}**`;
      }

      const contentLines = content.split("\n");
      lines.push(`${indent}${bullet}${contentLines[0]}`.trimEnd());
      for (const continuation of contentLines.slice(1)) {
        lines.push(`${indent}  ${continuation}`.trimEnd());
      }

      if (node.deadline) {
        lines.push(`${indent}  📅 ${formatUnixDate(node.deadline)}`);
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

export function htmlToMarkdown(html: string): string {
  if (!html) return "";
  const document = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  return renderChildren(document.body)
    .replace(/\u200b/g, "")
    .replace(/\*{4,}/g, "**")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderChildren(parent: ParentNode): string {
  return Array.from(parent.childNodes).map(renderHtmlNode).join("");
}

function renderHtmlNode(node: Node): string {
  if (node.nodeType === 3) return node.textContent || "";
  if (node.nodeType !== 1) return "";

  const element = node as HTMLElement;
  const tag = element.tagName.toLowerCase();
  const inner = renderChildren(element);

  if (tag === "span") return renderSpan(element, inner);

  switch (tag) {
    case "br":
      return "\n";
    case "p":
    case "div":
      return `${inner}\n`;
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
      return inner.trim() ? `\n\`\`\`\n${inner.trim()}\n\`\`\`\n` : "";
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
      return inner.trim()
        ? `${inner.trim().split("\n").map(line => `> ${line}`).join("\n")}\n`
        : "";
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
      return `${"#".repeat(Number(tag.slice(1)))} ${inner.trim()}\n`;
    default:
      return inner;
  }
}

function renderSpan(element: HTMLElement, inner: string): string {
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
  if (classes.some(name => name.startsWith("highlight-")) && value.trim()) {
    value = `==${value.trim()}==`;
  }
  return value;
}

function renderRichList(element: HTMLElement, ordered: boolean): string {
  const lines: string[] = [];
  const children = Array.from(element.children).filter(child => child.tagName.toLowerCase() === "li");
  children.forEach((child, index) => {
    const value = renderChildren(child).trim();
    lines.push(`${ordered ? `${index + 1}.` : "-"} ${value}`);
  });
  return `${lines.join("\n")}\n`;
}

function renderTable(table: HTMLElement): string {
  const rows = Array.from(table.querySelectorAll("tr")).map(row =>
    Array.from(row.querySelectorAll(":scope > th, :scope > td"))
      .map(cell => normalizeTableCell(cell.textContent || ""))
  ).filter(row => row.length > 0);

  if (rows.length === 0) return "";
  const width = Math.max(...rows.map(row => row.length));
  const normalized = rows.map(row => [...row, ...Array(Math.max(0, width - row.length)).fill("")]);
  const lines = [
    `| ${normalized[0].join(" | ")} |`,
    `| ${Array(width).fill("---").join(" | ")} |`
  ];
  for (const row of normalized.slice(1)) lines.push(`| ${row.join(" | ")} |`);
  return `\n${lines.join("\n")}\n`;
}

function normalizeTableCell(value: string): string {
  return value.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}

function extractImages(node: MubuNode): MubuImage[] {
  const images: MubuImage[] = [];
  if (node.image) images.push(node.image);
  if (Array.isArray(node.images)) images.push(...node.images);
  if (Array.isArray(node.imageList)) images.push(...node.imageList);
  return images;
}

function imageToMarkdown(image: MubuImage): string {
  const raw = image.uri || image.url || "";
  if (!raw) return "";
  const url = /^https?:\/\//i.test(raw) ? raw : `${IMAGE_HOST}${raw.replace(/^\/+/, "")}`;
  const alt = escapeMarkdownText(image.alt || image.name || "image");
  return `![${alt}](${url})`;
}

function isTaskNode(node: MubuNode): boolean {
  // Mubu may attach taskStatus: 0 to an otherwise ordinary text node (as seen
  // in exported document definitions). Keep the known unchecked value 1 for
  // compatibility, but never infer a task from an isolated zero.
  return node.taskStatus === 1
    || node.finish === true
    || node.completed === true;
}

function isCompletedTask(node: MubuNode): boolean {
  return node.finish === true || node.completed === true;
}

function formatUnixDate(timestamp: number): string {
  const date = new Date(timestamp * 1_000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function escapeMarkdownText(value: string): string {
  return value.split("[").join("").split("]").join("").split("`").join("").replace(/\s+/g, " ").trim();
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}
