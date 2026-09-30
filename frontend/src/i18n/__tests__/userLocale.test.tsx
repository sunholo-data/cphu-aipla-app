import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { LanguageSwitch } from "@/components/site/LanguageSwitch";
import { LocaleProvider, useLocaleMode } from "@/i18n";
import { USER_LOCALE_KEY, UserLocaleProvider } from "@/i18n/userLocale";

// 1.1.108 — the person's own language (remembered in this browser) versus the
// students' language (the activity's, which wins inside it).

// In-memory localStorage: Node's own global shadows jsdom's in this runner.
let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
  document.documentElement.lang = "en";
});

function Probe({ id }: { id: string }) {
  return <span data-testid={id}>{useLocaleMode()}</span>;
}

describe("UserLocaleProvider", () => {
  it("defaults to the site default and remembers an explicit choice", () => {
    const { unmount } = render(
      <UserLocaleProvider>
        <LanguageSwitch />
        <Probe id="p" />
      </UserLocaleProvider>,
    );
    expect(screen.getByTestId("p")).toHaveTextContent("da");
    expect(document.documentElement.lang).toBe("da");

    fireEvent.click(screen.getByRole("button", { name: "en" }));
    expect(screen.getByTestId("p")).toHaveTextContent("en");
    expect(store.get(USER_LOCALE_KEY)).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    unmount();

    // A later visit starts in the remembered language.
    render(
      <UserLocaleProvider>
        <Probe id="again" />
      </UserLocaleProvider>,
    );
    expect(screen.getByTestId("again")).toHaveTextContent("en");
  });

  it("ignores a stored value that is not a supported locale", () => {
    store.set(USER_LOCALE_KEY, "fr");
    render(
      <UserLocaleProvider>
        <Probe id="p" />
      </UserLocaleProvider>,
    );
    expect(screen.getByTestId("p")).toHaveTextContent("da");
  });

  it("lets an activity's language win inside it — for the subtree AND <html lang>", () => {
    store.set(USER_LOCALE_KEY, "en");
    const { rerender } = render(
      <UserLocaleProvider>
        <Probe id="outside" />
        <LocaleProvider locale="da" syncHtmlLang>
          <Probe id="inside" />
        </LocaleProvider>
      </UserLocaleProvider>,
    );
    expect(screen.getByTestId("outside")).toHaveTextContent("en");
    expect(screen.getByTestId("inside")).toHaveTextContent("da");
    // Child effects run before parent effects; the deepest claim must still win.
    expect(document.documentElement.lang).toBe("da");

    // Leaving the activity hands <html lang> back to the person's setting.
    act(() => {
      rerender(
        <UserLocaleProvider>
          <Probe id="outside" />
        </UserLocaleProvider>,
      );
    });
    expect(document.documentElement.lang).toBe("en");
  });
});
