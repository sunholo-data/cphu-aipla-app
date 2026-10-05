import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reingestCurriculumDoc = vi.fn();
const fetchCurriculumRagStatus = vi.fn();
vi.mock("@/lib/curriculumApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/curriculumApi")>("@/lib/curriculumApi");
  return {
    ...actual,
    reingestCurriculumDoc: (...a: unknown[]) => reingestCurriculumDoc(...a),
    fetchCurriculumRagStatus: (...a: unknown[]) => fetchCurriculumRagStatus(...a),
  };
});

import { LocaleProvider, type Locale } from "@/i18n";
import type { CurriculumDoc } from "@/lib/curriculumApi";
import { FailedMaterialsWarning } from "../FailedMaterialsWarning";
import { RagStatusLine } from "../RagStatusLine";

/**
 * 1.1.151 F1c — a document the tutor cannot read is SAID to be unreadable,
 * in words, in both locales, with a way out. The 2026-09-07 failure was
 * invisible because every surface treated it like any other document.
 */

function doc(over: Partial<CurriculumDoc> = {}): CurriculumDoc {
  return {
    docId: "b594",
    title: "Prompt for Energi",
    level: null,
    topic: null,
    summary: "",
    tags: [],
    subject: null,
    folderId: null,
    folderName: null,
    source: "teacher_upload",
    ownerScope: "teacher-1",
    origin: "AR",
    docArtifactId: "",
    copyrightStatus: "teacher_owned",
    createdAt: "2026-09-07T11:07:49Z",
    updatedAt: "2026-09-07T11:07:49Z",
    ...over,
  };
}

const inLocale = (locale: Locale, ui: ReactElement) => render(<LocaleProvider locale={locale}>{ui}</LocaleProvider>);

beforeEach(() => {
  reingestCurriculumDoc.mockReset();
  fetchCurriculumRagStatus.mockReset();
});

describe("RagStatusLine", () => {
  const cases: Array<[Locale, Partial<CurriculumDoc>, string]> = [
    ["da", { ragStatus: "ready", docArtifactId: "rag/1" }, "Klar — tutoren kan læse den"],
    ["da", { ragStatus: "pending" }, "Behandles…"],
    ["da", { ragStatus: "failed" }, "Fejlede — tutoren kan ikke læse den"],
    ["en", { ragStatus: "ready", docArtifactId: "rag/1" }, "Ready — the tutor can read it"],
    ["en", { ragStatus: "pending" }, "Processing…"],
    ["en", { ragStatus: "failed" }, "Failed — the tutor cannot read it"],
  ];
  it.each(cases)("[%s] renders %o as %s", (locale, over, text) => {
    inLocale(locale, <RagStatusLine doc={doc(over)} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("derives a legacy row with no status and no RAG file as failed — never silently fine", () => {
    inLocale("da", <RagStatusLine doc={doc({ ragStatus: undefined, docArtifactId: "" })} />);
    expect(screen.getByText("Fejlede — tutoren kan ikke læse den")).toBeInTheDocument();
  });

  it("Prøv igen calls the reingest client and reports the new state", async () => {
    const onUpdated = vi.fn();
    reingestCurriculumDoc.mockResolvedValue(doc({ ragStatus: "ready", docArtifactId: "rag/new" }));
    inLocale("da", <RagStatusLine doc={doc({ ragStatus: "failed" })} onUpdated={onUpdated} />);
    fireEvent.click(screen.getByRole("button", { name: /Prøv at sende/ }));
    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
    expect(reingestCurriculumDoc).toHaveBeenCalledWith("b594");
    expect(onUpdated.mock.calls[0][0].ragStatus).toBe("ready");
  });

  it("says so when the retry also fails", async () => {
    reingestCurriculumDoc.mockResolvedValue(doc({ ragStatus: "failed", ragError: "Boom" }));
    inLocale("en", <RagStatusLine doc={doc({ ragStatus: "failed" })} />);
    fireEvent.click(screen.getByRole("button", { name: /Try sending/ }));
    expect(await screen.findByText("That didn't work. Try again in a moment.")).toBeInTheDocument();
  });

  it("hides the button when the viewer may not retry", () => {
    inLocale("da", <RagStatusLine doc={doc({ ragStatus: "failed" })} canRetry={false} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("FailedMaterialsWarning", () => {
  const materials = [
    { docId: "b594", origin: "AR", title: "Prompt for Energi", studentVisible: false },
    { docId: "ok", origin: "uvm", title: "Fine", studentVisible: false },
    { kind: "image" as const, docId: "", origin: "", studentVisible: true },
  ];

  it("warns on a failed cited doc and offers the retry", async () => {
    const onUpdated = vi.fn();
    reingestCurriculumDoc.mockResolvedValue(doc({ ragStatus: "ready", docArtifactId: "rag/new" }));
    inLocale(
      "da",
      <FailedMaterialsWarning
        materials={materials}
        statuses={{
          b594: { ragStatus: "failed", ragError: "x", title: "Prompt for Energi", canRetry: true },
          ok: { ragStatus: "ready", ragError: null, title: "Fine", canRetry: true },
        }}
        onUpdated={onUpdated}
      />,
    );
    expect(screen.getByText("Tutoren kan ikke læse 1 vedhæftet dokument")).toBeInTheDocument();
    expect(screen.getByText("Prompt for Energi")).toBeInTheDocument();
    expect(screen.queryByText("Fine")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Prøv at sende/ }));
    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith("b594", expect.objectContaining({ ragStatus: "ready" })));
  });

  it("renders nothing when every cited doc is readable", () => {
    const { container } = inLocale(
      "en",
      <FailedMaterialsWarning
        materials={materials}
        statuses={{ ok: { ragStatus: "ready", ragError: null, title: "Fine", canRetry: true } }}
        onUpdated={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("tells a non-owner to ask the owner instead of offering a retry it would 404", () => {
    inLocale(
      "en",
      <FailedMaterialsWarning
        materials={materials}
        statuses={{ b594: { ragStatus: "failed", ragError: null, title: "Prompt for Energi", canRetry: false } }}
        onUpdated={() => {}}
      />,
    );
    expect(screen.getByText("Ask the document's owner to try again.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
