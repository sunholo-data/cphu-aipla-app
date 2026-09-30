// 1.1.108 — the message catalogue, assembled from one JSON file per surface
// area under `frontend/messages/<locale>/`. Each file's top-level keys are
// NAMESPACES (by convention the component's name) and each namespace is a flat
// object of ICU message strings. A translator edits JSON with a text editor and
// never touches a component.
//
// Adding an area: add the JSON to BOTH locales and one line to each object
// below. `messages.test.ts` fails on a namespace or key present in one locale
// and missing in the other, and on two areas claiming the same namespace.

import daChatPage from "../../messages/da/chat-page.json";
import daChat from "../../messages/da/chat.json";
import daJoin from "../../messages/da/join.json";
import daLessons from "../../messages/da/lessons.json";
import daSite from "../../messages/da/site.json";
import daWorkspace from "../../messages/da/workspace.json";
import enChatPage from "../../messages/en/chat-page.json";
import enChat from "../../messages/en/chat.json";
import enJoin from "../../messages/en/join.json";
import enLessons from "../../messages/en/lessons.json";
import enSite from "../../messages/en/site.json";
import enWorkspace from "../../messages/en/workspace.json";

import type { Locale } from "./locale";

/** Per-area sources, kept separate so the test can detect namespace collisions. */
export const MESSAGE_AREAS = {
  da: { chat: daChat, chatPage: daChatPage, join: daJoin, lessons: daLessons, site: daSite, workspace: daWorkspace },
  en: { chat: enChat, chatPage: enChatPage, join: enJoin, lessons: enLessons, site: enSite, workspace: enWorkspace },
} as const;

const da = { ...daChat, ...daChatPage, ...daJoin, ...daLessons, ...daSite, ...daWorkspace };

/** Danish is the shape of record: English must supply every key it has. */
export type Messages = typeof da;
export type Namespace = keyof Messages;
export type MessageKey<N extends Namespace> = keyof Messages[N] & string;

const en: Messages = { ...enChat, ...enChatPage, ...enJoin, ...enLessons, ...enSite, ...enWorkspace };

export const MESSAGES: Record<Locale, Messages> = { da, en };
