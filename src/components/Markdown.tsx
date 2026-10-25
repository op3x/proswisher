import { Fragment, type ReactNode } from "react";

// Tiny renderer for the legal drafts in src/content (bold, italics, headings, bullets incl. one nested level,
// paragraphs, bare links). No HTML passthrough.
const BULLET = /^ *[-*] /;
const isNested = (l: string) => /^ {2,}[-*] /.test(l);
function inline(t: string): ReactNode[] {
  return t.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|https?:\/\/[^\s)]+[^\s).,;])/g).map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (/^\*[^*\s][^*]*\*$/.test(part)) return <em key={i}>{part.slice(1, -1)}</em>;
    if (/^https?:\/\//.test(part)) return <a key={i} href={part} className="text-accent underline" target="_blank" rel="noreferrer">{part}</a>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

// docTitle: the document's first heading is the page's single h1 (Sal #12); later headings are h2.
export function Markdown({ text, docTitle = false }: { text: string; docTitle?: boolean }) {
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/);
  return (
    <>
      {blocks.map((b, i) => {
        const lines = b.split("\n").filter(Boolean);
        if (!lines.length) return null;
        if (lines.every((l) => BULLET.test(l)))
          return <ul key={i} className="list-disc pl-5 space-y-2">{lines.map((l, j) => <li key={j} className={isNested(l) ? "ml-5 list-[circle]" : undefined}>{inline(l.replace(BULLET, ""))}</li>)}</ul>;
        const h = /^#{1,4} (.*)$/.exec(lines[0]) || /^\*\*([^*]+)\*\*$/.exec(lines[0]);
        if (h && docTitle && i === 0) return <Fragment key={i}><h1 className="text-2xl sm:text-3xl font-extrabold">{inline(h[1])}</h1>{lines.length > 1 && <Markdown text={lines.slice(1).join("\n")} />}</Fragment>;
        if (h) return <Fragment key={i}><h2 className="text-lg font-bold pt-2">{inline(h[1])}</h2>{lines.length > 1 && <Markdown text={lines.slice(1).join("\n")} />}</Fragment>;
        if (lines.some((l) => /^[-*] /.test(l)))
          return <Fragment key={i}>{lines.map((l, j) => /^[-*] /.test(l) ? <ul key={j} className="list-disc pl-5"><li>{inline(l.slice(2))}</li></ul> : <p key={j}>{inline(l)}</p>)}</Fragment>;
        return <p key={i}>{lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l)}</Fragment>)}</p>;
      })}
    </>
  );
}
