export function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = String(options.text);
  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    if (value !== undefined && value !== null) node.setAttribute(name, String(value));
  }
  for (const [name, value] of Object.entries(options.dataset ?? {})) {
    node.dataset[name] = String(value);
  }
  node.append(...children.filter(Boolean));
  return node;
}

export function replace(node, children = []) {
  node.replaceChildren(...children.filter(Boolean));
  return node;
}

export function formatValue(value) {
  if (value === undefined || value === null || value === "") return "未提供";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

export async function copyText(text, { navigatorRef = globalThis.navigator, documentRef = document } = {}) {
  if (navigatorRef?.clipboard?.writeText) {
    try {
      await navigatorRef.clipboard.writeText(text);
      return "clipboard";
    } catch {
      // file:// pages commonly expose Clipboard API while denying write access.
    }
  }
  if (!documentRef?.body || !documentRef.createElement || !documentRef.execCommand) {
    throw new Error("当前浏览器不允许自动复制，请在高级检查器中手动选择脱敏 JSON。");
  }
  const textarea = documentRef.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  Object.assign(textarea.style, { position: "fixed", opacity: "0", pointerEvents: "none" });
  documentRef.body.appendChild(textarea);
  textarea.select();
  const copied = documentRef.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("当前浏览器不允许自动复制，请在高级检查器中手动选择脱敏 JSON。");
  return "fallback";
}

export function selectTextContent(node, documentRef = document) {
  node.focus();
  const selection = documentRef.defaultView?.getSelection();
  if (!selection) return false;
  const range = documentRef.createRange();
  range.selectNodeContents(node);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}
