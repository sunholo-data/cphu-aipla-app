import { describe, expect, it } from "vitest";

import { localeForActivities, toLocale, translate } from "@/i18n";
import { MESSAGES, MESSAGE_AREAS } from "@/i18n/messages";
import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";

/** Every argument name an ICU message uses, including inside branches and tags. */
function argumentNames(elements: MessageFormatElement[], out = new Set<string>()): Set<string> {
  for (const el of elements) {
    if (el.type === TYPE.argument || el.type === TYPE.number || el.type === TYPE.date || el.type === TYPE.time) {
      out.add(el.value);
    } else if (el.type === TYPE.plural || el.type === TYPE.select) {
      out.add(el.value);
      for (const opt of Object.values(el.options)) argumentNames(opt.value, out);
    } else if (el.type === TYPE.tag) {
      out.add(`<${el.value}>`);
      argumentNames(el.children, out);
    }
  }
  return out;
}

// 1.1.108 — the catalogue's own invariants. A key in one locale and not the
// other would render the Danish fallback inside an English activity: exactly
// the mixed-language screen this work exists to end.

function keysOf(obj: Record<string, Record<string, string>>): string[] {
  return Object.entries(obj).flatMap(([ns, table]) => Object.keys(table).map((k) => `${ns}.${k}`));
}

describe("message catalogue", () => {
  it("has the same namespaces and keys in every locale", () => {
    expect(keysOf(MESSAGES.en).sort()).toEqual(keysOf(MESSAGES.da).sort());
  });

  it("never lets two areas claim the same namespace", () => {
    for (const areas of Object.values(MESSAGE_AREAS)) {
      const seen = new Map<string, string>();
      for (const [area, table] of Object.entries(areas)) {
        for (const ns of Object.keys(table)) {
          expect(seen.get(ns), `namespace ${ns} is in both ${seen.get(ns)} and ${area}`).toBeUndefined();
          seen.set(ns, area);
        }
      }
    }
  });

  it("keeps the same interpolation placeholders across locales", () => {
    // Argument names only, read with the real ICU parser: plural/select branch
    // bodies (`one {entry}`, `written {skrevet}`) are translated TEXT, and a
    // regex cannot tell them from placeholders once selects nest.
    const placeholders = (msg: string) => [...argumentNames(parse(msg, { ignoreTag: false }))].sort();
    for (const [ns, table] of Object.entries(MESSAGES.da)) {
      for (const [key, da] of Object.entries(table as Record<string, string>)) {
        const en = (MESSAGES.en as Record<string, Record<string, string>>)[ns][key];
        expect(placeholders(en), `${ns}.${key}`).toEqual(placeholders(da));
      }
    }
  });

  it("has no Danish letters anywhere in the English catalogue", () => {
    for (const k of keysOf(MESSAGES.en)) {
      const [ns, key] = k.split(".");
      const value = (MESSAGES.en as Record<string, Record<string, string>>)[ns][key];
      expect(value, k).not.toMatch(/[æøåÆØÅ]/);
    }
  });
});

describe("translate", () => {
  it("interpolates per locale", () => {
    expect(translate("da", "LessonsPage")("emptyForClass", { className: "1.b" })).toBe(
      "Din lærer har ikke tilføjet en aktivitet til 1.b endnu.",
    );
    expect(translate("en", "LessonsPage")("emptyForClass", { className: "1.b" })).toBe(
      "Your teacher hasn't added an activity to 1.b yet.",
    );
  });

  it("joins both languages in bilingual mode, Danish first", () => {
    expect(translate("bilingual", "LessonsPage")("title")).toBe("Aktiviteter / Activities");
  });
});

describe("locale resolution", () => {
  it("normalises payload values and defaults to Danish", () => {
    expect(toLocale("en")).toBe("en");
    expect(toLocale("en-GB")).toBe("en");
    expect(toLocale("da")).toBe("da");
    expect(toLocale(undefined)).toBe("da");
    expect(toLocale("fr")).toBe("da");
  });

  it("gives the picker the class language only when every activity agrees", () => {
    expect(localeForActivities(["en", "en"])).toBe("en");
    expect(localeForActivities(["da", undefined])).toBe("da");
    expect(localeForActivities(["da", "en"])).toBe("bilingual");
    expect(localeForActivities([])).toBe("bilingual");
  });
});

describe("remembered activity language (first paint)", () => {
  it("round-trips through sessionStorage and normalises", async () => {
    const { rememberActivityLanguages, recallActivityLanguage } = await import("@/i18n");
    sessionStorage.clear();
    expect(recallActivityLanguage("act-1")).toBeNull();
    rememberActivityLanguages([["act-1", "en"], ["act-2", undefined]]);
    expect(recallActivityLanguage("act-1")).toBe("en");
    expect(recallActivityLanguage("act-2")).toBe("da");
    expect(recallActivityLanguage(null)).toBeNull();
  });

  it("survives unreadable storage", async () => {
    const { recallActivityLanguage } = await import("@/i18n");
    sessionStorage.setItem("aipla.activityLanguage", "{not json");
    expect(recallActivityLanguage("act-1")).toBeNull();
  });
});
