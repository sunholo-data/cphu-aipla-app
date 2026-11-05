import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "../button";
import { ConfirmProvider, useConfirm } from "../confirm";
import { Toaster, notify } from "../toast";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { LocaleProvider } from "@/i18n";

afterEach(() => {
  vi.useRealTimers();
});

describe("Button", () => {
  it("disables itself and says what it is doing while pending", () => {
    render(
      <Button pending pendingLabel="Saving…">
        Save
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("aria-busy")).toBe("true");
  });
});

describe("useConfirm", () => {
  function Harness({ onResult }: { onResult: (ok: boolean) => void }) {
    const confirm = useConfirm();
    return (
      <button type="button" onClick={async () => onResult(await confirm({ title: "Delete it?", confirmLabel: "Delete" }))}>
        open
      </button>
    );
  }

  it("resolves true on confirm and false on cancel", async () => {
    const results: boolean[] = [];
    render(
      <LocaleProvider locale="en">
        <ConfirmProvider>
          <Harness onResult={(ok) => results.push(ok)} />
        </ConfirmProvider>
      </LocaleProvider>,
    );
    await userEvent.click(screen.getByText("open"));
    expect(await screen.findByRole("alertdialog", { name: "Delete it?" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByText("open"));
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(results).toEqual([true, false]));
  });

  it("falls back to window.confirm outside the provider", async () => {
    const spy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const results: boolean[] = [];
    render(<Harness onResult={(ok) => results.push(ok)} />);
    await userEvent.click(screen.getByText("open"));
    await waitFor(() => expect(results).toEqual([true]));
    expect(spy).toHaveBeenCalledWith("Delete it?");
    spy.mockRestore();
  });
});

describe("notify", () => {
  it("shows a toast, runs its action, and dismisses itself", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const undo = vi.fn();
    render(<Toaster />);
    act(() => {
      notify("Conversation deleted", { action: { label: "Undo", onClick: undo } });
      notify.error("Couldn't save");
    });
    expect(screen.getByText("Conversation deleted")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Couldn't save");
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledOnce();
    expect(screen.queryByText("Conversation deleted")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(9000);
    });
    expect(screen.queryByText("Couldn't save")).toBeNull();
  });
});

describe("useAsyncAction", () => {
  it("tracks pending, ignores double submits, and reports failure", async () => {
    let finish: (v: string) => void = () => {};
    const fn = vi.fn(() => new Promise<string>((r) => (finish = r)));
    const { result } = renderHook(() => useAsyncAction(fn, { error: "" }));
    let first: Promise<string | undefined> = Promise.resolve(undefined);
    act(() => {
      first = result.current.run();
      void result.current.run();
    });
    expect(result.current.pending).toBe(true);
    expect(fn).toHaveBeenCalledOnce();
    await act(async () => {
      finish("done");
      expect(await first).toBe("done");
    });
    expect(result.current.pending).toBe(false);

    const failing = renderHook(() =>
      useAsyncAction(async () => {
        throw new Error("Nope");
      }, { error: (e) => (e as Error).message }),
    );
    await act(async () => {
      expect(await failing.result.current.run()).toBeUndefined();
    });
    expect(failing.result.current.error).toBe("Nope");
  });
});

// Last: useAsyncAction's fallback raises a real toast in the module-global
// store, which would leak into the notify test above if it ran first.
describe("localisation (AIPLA: language is data, not code)", () => {
  it("labels the dialog's own buttons in Danish by default", async () => {
    function Open() {
      const confirm = useConfirm();
      return (
        <button type="button" onClick={() => void confirm({ title: "Slet?" })}>
          open
        </button>
      );
    }
    render(
      <ConfirmProvider>
        <Open />
      </ConfirmProvider>,
    );
    await userEvent.click(screen.getByText("open"));
    expect(await screen.findByRole("button", { name: "Annuller" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bekræft" })).toBeTruthy();
  });

  it("falls back to a localised error when the error has no message", async () => {
    const { result } = renderHook(() =>
      useAsyncAction(async () => {
        throw new Error("");
      }),
    );
    await act(async () => {
      await result.current.run();
    });
    expect(result.current.error).toBe("Noget gik galt. Prøv igen.");
  });
});
