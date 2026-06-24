"use client";

import { useCallback, useEffect, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { BlockMath, InlineMath } from "@tiptap/extension-mathematics";
import "katex/dist/katex.min.css";
import {
  Bold,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Radical,
  Redo2,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";

import { solutionDocToMarkdown, solutionWordCount, type PMNode } from "@/lib/solutionMarkdown";

/** The editor's persisted draft = the ProseMirror JSON doc (no markdown→TipTap
 *  parse on reload). Markdown is derived on submit. */
export type SolutionDoc = PMNode;

interface WorkbenchSolutionProps {
  /** Restored draft (ProseMirror JSON), or null for a blank editor. */
  initialDoc?: SolutionDoc | null;
  /** Teacher-authored prompt shown above the editor ("Write your solution to…"). */
  prompt?: string;
  /** Read-only (e.g. the builder preview has no student to type). */
  readOnly?: boolean;
  /** Fired (debounced) as the student types — persist the draft JSON ("Gem kladde"). */
  onDraftChange?: (doc: SolutionDoc) => void;
  /** Fired on explicit submit ("Gem løsning") with the serialised markdown + the
   *  doc — the mount site pushes the markdown to the tutor and persists the doc. */
  onSubmit?: (markdown: string, doc: SolutionDoc) => Promise<void> | void;
}

const AUTOSAVE_MS = 800;

/**
 * WorkbenchSolution (1.1.45 M4 — JB-2 "din løsning"): a lazy-loaded TipTap
 * rich-text editor where the student writes their physics solution — bold /
 * italic / underline, bullet + numbered lists, link, image, **`fx` KaTeX math**,
 * undo/redo — with a word count, autosaved draft ("Gem kladde") and an explicit
 * submit ("Gem løsning") that serialises to markdown for the tutor.
 *
 * Source of truth is the ProseMirror JSON doc (persisted for reload); the tutor
 * gets derived markdown (+`$…$` math) via `solutionDocToMarkdown`. Mount via
 * `next/dynamic` (ssr:false) so the editor bundle stays off the chat first-load.
 */
export function WorkbenchSolution({
  initialDoc = null,
  prompt,
  readOnly = false,
  onDraftChange,
  onSubmit,
}: WorkbenchSolutionProps) {
  const [submitting, setSubmitting] = useState(false);
  const [savedAt, setSavedAt] = useState<"draft" | "submitted" | null>(null);
  const [wordCount, setWordCount] = useState(() => solutionWordCount(initialDoc));

  const editor = useEditor({
    // Next.js SSR — must be false or hydration mismatches (TipTap v3 requirement).
    immediatelyRender: false,
    editable: !readOnly,
    extensions: [
      // StarterKit v3 bundles bold/italic/underline/link/lists/history/etc.
      StarterKit.configure({ link: { openOnClick: false } }),
      Image.configure({ inline: false, allowBase64: true }),
      InlineMath,
      BlockMath,
    ],
    content: initialDoc ?? undefined,
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none min-h-[10rem] rounded-md border border-border bg-background px-3 py-2 focus:outline-none",
        "aria-label": "Solution editor",
      },
    },
    onUpdate: ({ editor: ed }) => setWordCount(solutionWordCount(ed.getJSON() as PMNode)),
  });

  // Debounced draft autosave — persist the JSON doc as the student types.
  useEffect(() => {
    if (!editor || readOnly || !onDraftChange) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        onDraftChange(editor.getJSON() as PMNode);
        setSavedAt("draft");
      }, AUTOSAVE_MS);
    };
    editor.on("update", schedule);
    return () => {
      if (timer) clearTimeout(timer);
      editor.off("update", schedule);
    };
  }, [editor, readOnly, onDraftChange]);

  const submit = useCallback(async () => {
    if (!editor || !onSubmit) return;
    const docJson = editor.getJSON() as PMNode;
    setSubmitting(true);
    try {
      await onSubmit(solutionDocToMarkdown(docJson), docJson);
      setSavedAt("submitted");
    } finally {
      setSubmitting(false);
    }
  }, [editor, onSubmit]);

  if (!editor) {
    return (
      <div className="flex h-40 items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      </div>
    );
  }

  return (
    <section className="flex min-h-0 flex-col gap-2 p-2" aria-label="Din løsning">
      {prompt ? <p className="text-sm font-medium text-foreground">{prompt}</p> : null}
      {!readOnly ? <Toolbar editor={editor} /> : null}
      <EditorContent editor={editor} />
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {wordCount} {wordCount === 1 ? "ord" : "ord"}
          {savedAt === "draft" ? " · kladde gemt" : savedAt === "submitted" ? " · løsning sendt" : ""}
        </span>
        {!readOnly && onSubmit ? (
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Gem løsning
          </button>
        ) : null}
      </div>
    </section>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const [, force] = useState(0);
  // Re-render the toolbar on selection/transaction so active states track.
  useEffect(() => {
    const rerender = () => force((n) => n + 1);
    editor.on("selectionUpdate", rerender);
    editor.on("transaction", rerender);
    return () => {
      editor.off("selectionUpdate", rerender);
      editor.off("transaction", rerender);
    };
  }, [editor]);

  const addLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev ?? "https://");
    if (url === null) return;
    if (url === "") editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };
  const addImage = () => {
    const url = window.prompt("Billede-URL");
    if (url) editor.chain().focus().setImage({ src: url }).run();
  };
  const addMath = () => {
    const latex = window.prompt("Matematik (LaTeX)", "");
    if (latex) editor.chain().focus().insertContent({ type: "inlineMath", attrs: { latex } }).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5" role="toolbar" aria-label="Formatering">
      <TBtn label="Fed" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className="h-4 w-4" aria-hidden="true" />
      </TBtn>
      <TBtn label="Kursiv" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className="h-4 w-4" aria-hidden="true" />
      </TBtn>
      <TBtn
        label="Understreget"
        active={editor.isActive("underline")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon className="h-4 w-4" aria-hidden="true" />
      </TBtn>
      <TBtn
        label="Punktliste"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="h-4 w-4" aria-hidden="true" />
      </TBtn>
      <TBtn
        label="Nummereret liste"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="h-4 w-4" aria-hidden="true" />
      </TBtn>
      <TBtn label="Link" active={editor.isActive("link")} onClick={addLink}>
        <Link2 className="h-4 w-4" aria-hidden="true" />
      </TBtn>
      <TBtn label="Billede" active={false} onClick={addImage}>
        <ImageIcon className="h-4 w-4" aria-hidden="true" />
      </TBtn>
      <TBtn label="Matematik (fx)" active={false} onClick={addMath}>
        <Radical className="h-4 w-4" aria-hidden="true" />
      </TBtn>
      <TBtn label="Fortryd" active={false} onClick={() => editor.chain().focus().undo().run()}>
        <Undo2 className="h-4 w-4" aria-hidden="true" />
      </TBtn>
      <TBtn label="Gentag" active={false} onClick={() => editor.chain().focus().redo().run()}>
        <Redo2 className="h-4 w-4" aria-hidden="true" />
      </TBtn>
    </div>
  );
}

function TBtn({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={`rounded p-1.5 hover:bg-muted ${active ? "bg-muted text-foreground" : "text-muted-foreground"}`}
    >
      {children}
    </button>
  );
}
