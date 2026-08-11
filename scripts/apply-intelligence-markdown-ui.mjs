import fs from "node:fs";

const componentPath = "src/app/BrandIntelligenceChat.tsx";
const cssPath = "src/app/BrandIntelligenceChat.module.css";

let source = fs.readFileSync(componentPath, "utf8");
const start = source.indexOf("function inlineText(value: string) {");
const end = source.indexOf("\nfunction SourceDetails(", start);
if (start < 0 || end < 0) throw new Error("Brand Intelligence conversational renderer anchor not found");

const renderer = String.raw`function inlineText(value: string) {
  return value.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={part + "-" + index}>{part.slice(2, -2)}</strong>
      : <Fragment key={part + "-" + index}>{part}</Fragment>,
  );
}

function tableCells(line: string) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isTableDivider(line: string) {
  const cells = tableCells(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function startsMarkdownBlock(lines: string[], index: number) {
  const line = (lines[index] ?? "").trim();
  if (!line) return true;
  if (/^#{1,6}\s+/.test(line) || /^[-*+]\s+/.test(line) || /^\d+[.)]\s+/.test(line) || /^>\s?/.test(line)) return true;
  return line.includes("|") && index + 1 < lines.length && isTableDivider(lines[index + 1] ?? "");
}

function MarkdownTable({ lines }: { lines: string[] }) {
  const headers = tableCells(lines[0] ?? "");
  const rows = lines.slice(2).map(tableCells);
  return <div className={styles.markdownTableWrap}>
    <table className={styles.markdownTable}>
      <thead><tr>{headers.map((header, index) => <th key={"header-" + index}>{inlineText(header)}</th>)}</tr></thead>
      <tbody>{rows.map((row, rowIndex) => <tr key={"row-" + rowIndex}>{headers.map((_, cellIndex) => <td key={"cell-" + rowIndex + "-" + cellIndex}>{inlineText(row[cellIndex] ?? "")}</td>)}</tr>)}</tbody>
    </table>
  </div>;
}

function ConversationalAnswer({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").trim().split("\n");
  const blocks = [];
  let index = 0;
  let blockKey = 0;

  while (index < lines.length) {
    const line = (lines[index] ?? "").trim();
    if (!line) { index += 1; continue; }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const content = inlineText(heading[2]);
      blocks.push(level <= 2
        ? <h3 key={"heading-" + blockKey++}>{content}</h3>
        : <h4 key={"heading-" + blockKey++}>{content}</h4>);
      index += 1;
      continue;
    }

    if (line.includes("|") && index + 1 < lines.length && isTableDivider(lines[index + 1] ?? "")) {
      const tableLines = [lines[index], lines[index + 1]];
      index += 2;
      while (index < lines.length) {
        const row = (lines[index] ?? "").trim();
        if (!row || !row.includes("|")) break;
        tableLines.push(lines[index]);
        index += 1;
      }
      blocks.push(<MarkdownTable key={"table-" + blockKey++} lines={tableLines}/>);
      continue;
    }

    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*+]\s+/.test((lines[index] ?? "").trim())) {
        items.push((lines[index] ?? "").trim().replace(/^[-*+]\s+/, ""));
        index += 1;
      }
      blocks.push(<ul key={"ul-" + blockKey++}>{items.map((item, itemIndex) => <li key={itemIndex}>{inlineText(item)}</li>)}</ul>);
      continue;
    }

    if (/^\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+[.)]\s+/.test((lines[index] ?? "").trim())) {
        items.push((lines[index] ?? "").trim().replace(/^\d+[.)]\s+/, ""));
        index += 1;
      }
      blocks.push(<ol key={"ol-" + blockKey++}>{items.map((item, itemIndex) => <li key={itemIndex}>{inlineText(item)}</li>)}</ol>);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test((lines[index] ?? "").trim())) {
        quote.push((lines[index] ?? "").trim().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(<blockquote key={"quote-" + blockKey++}>{quote.map((item, itemIndex) => <Fragment key={itemIndex}>{itemIndex > 0 && <br/>}{inlineText(item)}</Fragment>)}</blockquote>);
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && (lines[index] ?? "").trim() && !startsMarkdownBlock(lines, index)) {
      paragraph.push((lines[index] ?? "").trim());
      index += 1;
    }
    blocks.push(<p key={"p-" + blockKey++}>{paragraph.map((item, itemIndex) => <Fragment key={itemIndex}>{itemIndex > 0 && <br/>}{inlineText(item)}</Fragment>)}</p>);
  }

  return <div className={styles.answer}>{blocks}</div>;
}
`;

source = source.slice(0, start) + renderer + source.slice(end);
fs.writeFileSync(componentPath, source);

let css = fs.readFileSync(cssPath, "utf8");
const marker = "/* intelligence-markdown-renderer-v1 */";
if (!css.includes(marker)) {
  css += `\n${marker}\n.answer h4{margin:10px 0 7px;color:#20324f;font-size:13px;line-height:1.4}.answer blockquote{margin:10px 0;padding:9px 12px;border-left:3px solid #8bb1ff;border-radius:0 8px 8px 0;background:#f1f6ff;color:#4e607a}.markdownTableWrap{width:100%;max-width:100%;margin:10px 0 12px;overflow-x:auto;border:1px solid #dce5f0;border-radius:11px;background:#fff;box-shadow:0 2px 7px rgba(37,65,105,.035)}.markdownTable{width:100%;min-width:520px;border-collapse:separate;border-spacing:0;font-size:12px;line-height:1.45}.markdownTable th,.markdownTable td{padding:9px 11px;border-right:1px solid #e7edf5;border-bottom:1px solid #e7edf5;text-align:left;vertical-align:top;white-space:normal}.markdownTable th:last-child,.markdownTable td:last-child{border-right:0}.markdownTable tbody tr:last-child td{border-bottom:0}.markdownTable th{background:#f1f5fb;color:#4f617a;font-size:10px;font-weight:850;letter-spacing:.02em}.markdownTable td{color:#26364d}.markdownTable td strong{color:#14243b}.markdownTable tbody tr:nth-child(even) td{background:#fbfcfe}@media(max-width:760px){.markdownTable{min-width:440px}.markdownTable th,.markdownTable td{padding:8px 9px}.answer{font-size:12.5px}}\n`;
  fs.writeFileSync(cssPath, css);
}

console.log("MGP Intelligence markdown renderer ready");
