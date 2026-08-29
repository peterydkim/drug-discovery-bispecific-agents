import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ gfm: true, breaks: false });

/**
 * Agent output is model-generated and may quote arbitrary web content, so it is
 * sanitised before it reaches the DOM. Links are forced to open in a new tab
 * with no referrer.
 */
export function Markdown({ source }: { source: string }) {
  const html = useMemo(() => {
    const raw = marked.parse(source ?? "", { async: false }) as string;
    return DOMPurify.sanitize(raw, {
      ADD_ATTR: ["target", "rel"],
      FORBID_TAGS: ["style", "form", "input", "iframe", "object", "embed"],
    });
  }, [source]);

  return (
    <div
      className="md"
      onClickCapture={(e) => {
        const a = (e.target as HTMLElement).closest("a");
        if (a) {
          a.setAttribute("target", "_blank");
          a.setAttribute("rel", "noopener noreferrer");
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
