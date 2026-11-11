import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/i18n";

import { LoadError } from "../load-error";
import { RowMenu } from "../row-menu";

describe("LoadError", () => {
  it("names what failed, is announced, and retries", async () => {
    const onRetry = vi.fn();
    render(
      <LocaleProvider locale="da">
        <LoadError what="Sessionerne" onRetry={onRetry} />
      </LocaleProvider>,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Sessionerne kunne ikke hentes");
    await userEvent.click(screen.getByRole("button", { name: "Prøv igen" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("renders no button when there is nothing to retry", () => {
    render(
      <LocaleProvider locale="en">
        <LoadError what="Sessions" />
      </LocaleProvider>,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("RowMenu", () => {
  it("opens from the keyboard and runs the chosen item", async () => {
    const onCopy = vi.fn();
    const onRevoke = vi.fn();
    render(
      <LocaleProvider locale="en">
        <RowMenu
          label="More actions for g-1"
          items={[
            { id: "copy", label: "Copy code", onSelect: onCopy },
            { id: "revoke", label: "Revoke…", onSelect: onRevoke, danger: true },
          ]}
        />
      </LocaleProvider>,
    );
    const trigger = screen.getByRole("button", { name: "More actions for g-1" });
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    const items = await screen.findAllByRole("menuitem");
    // Safe actions first, destructive after the separator.
    expect(items.map((i) => i.textContent)).toEqual(["Copy code", "Revoke…"]);
    await userEvent.click(items[1]);
    expect(onRevoke).toHaveBeenCalledOnce();
    expect(onCopy).not.toHaveBeenCalled();
  });
});
