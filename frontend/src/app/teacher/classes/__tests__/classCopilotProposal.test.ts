import { describe, expect, it, vi, beforeEach } from "vitest";

import { applyClassProposal, classProposalDescriptor, parseClassProposal } from "../classCopilotProposal";
import type { ClassProposal } from "../classCopilotProposal";
import type { ToolCallState } from "@/hooks/useSkillAgent";

const createClass = vi.fn().mockResolvedValue({});
const mintGroupCodes = vi.fn().mockResolvedValue({ classId: "c1", codes: [] });
vi.mock("@/lib/teacherApi", () => ({
  createClass: (...args: unknown[]) => createClass(...args),
  mintGroupCodes: (...args: unknown[]) => mintGroupCodes(...args),
}));

function tc(resultContent: string | undefined, over: Partial<ToolCallState> = {}): ToolCallState {
  return { id: "t1", name: "create_class", status: "success", parentMessageId: "m1", resultContent, ...over } as ToolCallState;
}

beforeEach(() => {
  createClass.mockClear();
  mintGroupCodes.mockClear();
});

describe("parseClassProposal", () => {
  it("parses a create_class proposal", () => {
    const p = parseClassProposal(tc(JSON.stringify({ ok: true, proposal: { kind: "create_class", name: "Fysik 9A", description: "Vår" } })));
    expect(p).toEqual({ kind: "create_class", name: "Fysik 9A", description: "Vår" });
  });

  it("parses a mint_codes proposal (class_id/class_name → camelCase)", () => {
    const p = parseClassProposal(
      tc(JSON.stringify({ ok: true, proposal: { kind: "mint_codes", class_id: "c1", class_name: "9A", count: 3 } }), { name: "mint_group_codes" }),
    );
    expect(p).toEqual({ kind: "mint_codes", classId: "c1", className: "9A", count: 3 });
  });

  it("returns null for a soft error (ok:false)", () => {
    expect(parseClassProposal(tc(JSON.stringify({ ok: false, error: "a class name is required" })))).toBeNull();
  });

  it("returns null for a non-JSON / read-tool result", () => {
    expect(parseClassProposal(tc("You have 2 classes."))).toBeNull();
  });

  it("returns null for an unknown proposal kind", () => {
    expect(parseClassProposal(tc(JSON.stringify({ ok: true, proposal: { kind: "delete_class" } })))).toBeNull();
  });

  it("returns null until the tool call succeeds", () => {
    expect(parseClassProposal(tc(undefined, { status: "running", resultContent: undefined }))).toBeNull();
  });
});

describe("classProposalDescriptor", () => {
  const create: ClassProposal = { kind: "create_class", name: "Fysik 9A", description: null };
  const mint: ClassProposal = { kind: "mint_codes", classId: "c1", className: "9A", count: 1 };

  it("titles each kind", () => {
    expect(classProposalDescriptor.title(create)).toMatch(/new class/i);
    expect(classProposalDescriptor.title(mint)).toBe("Mint 1 join-code for 9A");
  });

  it("makes the class name editable, mint not", () => {
    expect(classProposalDescriptor.editableText!(create)).toBe("Fysik 9A");
    expect(classProposalDescriptor.editableText!(mint)).toBeNull();
  });

  it("edits the name on a create proposal", () => {
    expect(classProposalDescriptor.withEditedText!(create, "Fysik 9B")).toMatchObject({ name: "Fysik 9B" });
  });
});

describe("applyClassProposal", () => {
  it("create_class → createClass({name, description})", async () => {
    await applyClassProposal({ kind: "create_class", name: "Fysik 9A", description: "Vår" });
    expect(createClass).toHaveBeenCalledWith({ name: "Fysik 9A", description: "Vår" });
  });

  it("create_class with null description → undefined", async () => {
    await applyClassProposal({ kind: "create_class", name: "X", description: null });
    expect(createClass).toHaveBeenCalledWith({ name: "X", description: undefined });
  });

  it("mint_codes → mintGroupCodes(classId, count)", async () => {
    await applyClassProposal({ kind: "mint_codes", classId: "c1", className: "9A", count: 5 });
    expect(mintGroupCodes).toHaveBeenCalledWith("c1", 5);
  });
});
