// Small scanners that keep the position of every value, so masking can replace exactly the sensitive ranges of a body
// and leave the rest as it was sent (no re-serializing, so number precision, key order and whitespace survive).

export type Replacement = { start: number; end: number; text: string };

/** Applies replacements (non-overlapping after de-duplication, any order) to a text. */
export function applyReplacements(text: string, replacements: Replacement[]): string {
  const sorted = [...new Map(replacements.map((r) => [`${r.start}:${r.end}`, r])).values()].sort((a, b) => a.start - b.start || b.end - a.end);
  let out = "";
  let at = 0;
  for (const r of sorted) {
    if (r.start < at) continue; // inside one already replaced
    out += text.slice(at, r.start) + r.text;
    at = r.end;
  }
  return out + text.slice(at);
}

/**
 * Like `applyReplacements`, and also the replacements that undo it: each one's range in the *output* and the text it
 * replaced. Applying `restore` to the output gives the original back, so a Call can keep just the replaced pieces.
 */
export function applyWithRestore(text: string, replacements: Replacement[]): { text: string; restore: Replacement[] } {
  const sorted = [...new Map(replacements.map((r) => [`${r.start}:${r.end}`, r])).values()].sort((a, b) => a.start - b.start || b.end - a.end);
  let out = "";
  let at = 0;
  const restore: Replacement[] = [];
  for (const r of sorted) {
    if (r.start < at) continue;
    out += text.slice(at, r.start);
    restore.push({ start: out.length, end: out.length + r.text.length, text: text.slice(r.start, r.end) });
    out += r.text;
    at = r.end;
  }
  return { text: out + text.slice(at), restore };
}

// ---- JSON -------------------------------------------------------------------------------------------------------

export type JsonNode =
  | { kind: "object"; start: number; end: number; entries: { key: string; keyStart: number; keyEnd: number; value: JsonNode }[] }
  | { kind: "array"; start: number; end: number; items: JsonNode[] }
  | { kind: "scalar"; start: number; end: number };

const MAX_DEPTH = 200;

/** Parses JSON text to positions, or null when it is not one complete, valid JSON value. */
export function scanJson(text: string): JsonNode | null {
  let i = 0;
  const ws = () => {
    while (i < text.length && (text[i] === " " || text[i] === "\t" || text[i] === "\n" || text[i] === "\r")) i++;
  };
  const str = (): string | null => {
    const start = i;
    if (text[i] !== '"') return null;
    i++;
    while (i < text.length) {
      const c = text[i]!;
      if (c === "\\") i += 2;
      else if (c === '"') {
        i++;
        try {
          return JSON.parse(text.slice(start, i)) as string;
        } catch {
          return null;
        }
      } else i++;
    }
    return null;
  };
  const value = (depth: number): JsonNode | null => {
    if (depth > MAX_DEPTH) return null;
    ws();
    const start = i;
    const c = text[i];
    if (c === "{") {
      i++;
      const entries: Extract<JsonNode, { kind: "object" }>["entries"] = [];
      ws();
      if (text[i] === "}") return { kind: "object", start, end: ++i, entries };
      for (;;) {
        ws();
        const keyStart = i;
        const key = str();
        if (key === null) return null;
        const keyEnd = i;
        ws();
        if (text[i++] !== ":") return null;
        const v = value(depth + 1);
        if (!v) return null;
        entries.push({ key, keyStart, keyEnd, value: v });
        ws();
        if (text[i] === ",") i++;
        else if (text[i] === "}") return { kind: "object", start, end: ++i, entries };
        else return null;
      }
    }
    if (c === "[") {
      i++;
      const items: JsonNode[] = [];
      ws();
      if (text[i] === "]") return { kind: "array", start, end: ++i, items };
      for (;;) {
        const v = value(depth + 1);
        if (!v) return null;
        items.push(v);
        ws();
        if (text[i] === ",") i++;
        else if (text[i] === "]") return { kind: "array", start, end: ++i, items };
        else return null;
      }
    }
    if (c === '"') return str() === null ? null : { kind: "scalar", start, end: i };
    const m = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i, i + 64));
    if (!m) return null;
    i += m[0].length;
    return { kind: "scalar", start, end: i };
  };
  const root = value(0);
  if (!root) return null;
  ws();
  return i === text.length ? root : null;
}

// ---- XML --------------------------------------------------------------------------------------------------------

export type XmlElement = {
  /** The name without a namespace prefix. */
  name: string;
  start: number;
  end: number;
  /** Where the content (between the open and close tags) begins and ends; equal for an empty or self-closing element. */
  contentStart: number;
  contentEnd: number;
  attrs: { name: string; valueStart: number; valueEnd: number }[];
  children: XmlElement[];
};

/** Parses XML text to element positions, or null when it is not one well-formed element tree. DTDs are not followed. */
export function scanXml(text: string): XmlElement | null {
  let i = 0;
  const skipMisc = (): boolean => {
    for (;;) {
      while (i < text.length && /\s/.test(text[i]!)) i++;
      if (text.startsWith("<?", i)) {
        const e = text.indexOf("?>", i);
        if (e === -1) return false;
        i = e + 2;
      } else if (text.startsWith("<!--", i)) {
        const e = text.indexOf("-->", i);
        if (e === -1) return false;
        i = e + 3;
      } else if (text.startsWith("<!DOCTYPE", i)) {
        return false; // never followed
      } else return true;
    }
  };
  const element = (depth: number): XmlElement | null => {
    if (depth > MAX_DEPTH || text[i] !== "<") return null;
    const start = i;
    i++;
    const nm = /^[^\s/>]+/.exec(text.slice(i, i + 256));
    if (!nm) return null;
    i += nm[0].length;
    const name = nm[0].replace(/^.*:/, "");
    const attrs: XmlElement["attrs"] = [];
    for (;;) {
      while (i < text.length && /\s/.test(text[i]!)) i++;
      if (text[i] === "/") {
        if (text[i + 1] !== ">") return null;
        i += 2;
        return { name, start, end: i, contentStart: i, contentEnd: i, attrs, children: [] };
      }
      if (text[i] === ">") {
        i++;
        break;
      }
      const an = /^[^\s=/>]+/.exec(text.slice(i, i + 256));
      if (!an) return null;
      i += an[0].length;
      while (/\s/.test(text[i] ?? "")) i++;
      if (text[i] !== "=") return null;
      i++;
      while (/\s/.test(text[i] ?? "")) i++;
      const q = text[i];
      if (q !== '"' && q !== "'") return null;
      const close = text.indexOf(q, i + 1);
      if (close === -1) return null;
      attrs.push({ name: an[0].replace(/^.*:/, ""), valueStart: i + 1, valueEnd: close });
      i = close + 1;
    }
    const contentStart = i;
    const children: XmlElement[] = [];
    for (;;) {
      const lt = text.indexOf("<", i);
      if (lt === -1) return null;
      i = lt;
      if (text.startsWith("</", i)) {
        const contentEnd = i;
        const gt = text.indexOf(">", i);
        if (gt === -1) return null;
        i = gt + 1;
        return { name, start, end: i, contentStart, contentEnd, attrs, children };
      }
      if (text.startsWith("<!--", i)) {
        const e = text.indexOf("-->", i);
        if (e === -1) return null;
        i = e + 3;
      } else if (text.startsWith("<![CDATA[", i)) {
        const e = text.indexOf("]]>", i);
        if (e === -1) return null;
        i = e + 3;
      } else if (text.startsWith("<?", i)) {
        const e = text.indexOf("?>", i);
        if (e === -1) return null;
        i = e + 2;
      } else {
        const child = element(depth + 1);
        if (!child) return null;
        children.push(child);
      }
    }
  };
  if (!skipMisc()) return null;
  const root = element(0);
  if (!root) return null;
  if (!skipMisc()) return null;
  return i === text.length ? root : null;
}
