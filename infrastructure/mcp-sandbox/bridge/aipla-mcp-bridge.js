/* ============================================================================
 * AIPLA MCP App guest bridge — ONE canonical transport for every host.
 *
 * SOURCE OF TRUTH. This file is inlined verbatim into every artefact's
 * index.html between the `@aipla-bridge:start … @aipla-bridge:end` markers by
 * `scripts/build-artefact-bridge.mjs` (run `make sim-build`). NEVER hand-edit
 * the inlined copy — edit THIS file and rebuild. CI (`--check`) fails on drift.
 *
 * It speaks whichever host is present:
 *   - AIPLA app / SEP-1865 hosts  → JSON-RPC `ui/update-model-context` over
 *                                   window.parent.postMessage (the app reads
 *                                   structuredContent + renders the trust card).
 *   - ChatGPT (OpenAI Apps SDK)   → window.openai.setWidgetState (durable state)
 *                                   + window.openai.sendFollowUpMessage (turns a
 *                                   deliberate commit into an immediate turn).
 *   - Claude Desktop / Inspector  → the same SEP-1865 postMessage + `content`.
 *
 * The window.openai block is guarded end-to-end: absent in the AIPLA app and
 * Claude, so it is a pure no-op there and the postMessage path stays
 * authoritative. See docs/design/aipla/v1.1.0-feedback/shared-mcp-app-bridge.md.
 *
 * Public surface (window.AIPLA_BRIDGE):
 *   emit(kind, extra)                 — report a student interaction. `kind` is
 *                                       the FULL event kind (e.g. "boldkast.play").
 *                                       `extra.label` (a curated string) marks a
 *                                       DELIBERATE COMMIT — only labelled emits
 *                                       inject a ChatGPT follow-up turn.
 *   init({ name, version })           — run the ui/initialize handshake. Call once
 *                                       at the bottom of the artefact script.
 *   onChatFlush(cb)                   — cb() runs on ui/notifications/chat-flush.
 *   onHostNotification(method, cb)    — cb(params, msg) runs on any host→iframe
 *                                       JSON-RPC notification with that method.
 *   hostContext()                     — the hostContext returned by ui/initialize.
 *
 * Conservative JS (var/function) so it runs unchanged in any host iframe engine.
 * ========================================================================== */
(function () {
  "use strict";

  var __rpcNextId = 1;
  var __initialized = false;
  var __pendingEmits = [];
  var __hostContext = null;
  var __handlers = {}; // method -> [cb]

  function __post(msg) {
    try {
      // targetOrigin "*" is safe: the outer sandbox proxy validates origin on
      // its side per ADR-013, then re-postMessages to the host with the host's
      // specific origin. In standalone (artefact opened directly) parent may not
      // exist — swallow.
      window.parent.postMessage(msg, "*");
    } catch (e) {
      /* no host */
    }
  }

  function rpcNotify(method, params) {
    __post({ jsonrpc: "2.0", method: method, params: params || {} });
  }

  function rpcRequest(method, params) {
    return new Promise(function (resolve, reject) {
      var id = __rpcNextId++;
      var listener = function (e) {
        var d = e.data;
        if (!d || d.id !== id) return;
        window.removeEventListener("message", listener);
        if (d.result !== undefined) resolve(d.result);
        else reject(new Error((d.error && d.error.message) || "rpc error"));
      };
      window.addEventListener("message", listener);
      __post({ jsonrpc: "2.0", id: id, method: method, params: params || {} });
    });
  }

  // Single host→iframe listener: respond to ping (spec), dispatch registered
  // notification handlers. rpcRequest installs its own short-lived id-matched
  // listener separately for responses.
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.jsonrpc !== "2.0") return;
    if (d.method === "ping" && d.id !== undefined && d.id !== null) {
      __post({ jsonrpc: "2.0", id: d.id, result: {} });
      return;
    }
    if (d.method && __handlers[d.method]) {
      var cbs = __handlers[d.method];
      for (var i = 0; i < cbs.length; i++) {
        try {
          cbs[i](d.params, d);
        } catch (err) {
          /* a handler throwing must not break the bridge */
        }
      }
    }
  });

  // Derive a human-readable `content` text for generic MCP hosts (ChatGPT /
  // Claude feed `content` to the model and treat `structuredContent` as
  // schema-validated app data — without a text the model never sees the
  // interaction). Prefers the curated `label`; else summarises the payload.
  // The AIPLA frontend reads structuredContent and IGNORES content, so this is
  // purely additive for our own app.
  function __contentText(kind, p) {
    if (p && typeof p.label === "string" && p.label) return p.label;
    if (!p) return kind;
    var parts = [];
    for (var k in p) {
      if (k === "label") continue;
      var v = p[k];
      if (Array.isArray(v)) {
        parts.push(k + "=[" + v.length + "]");
      } else if (v && typeof v === "object") {
        for (var k2 in v) {
          if (v[k2] == null || typeof v[k2] !== "object") parts.push(k2 + "=" + v[k2]);
        }
      } else {
        parts.push(k + "=" + v);
      }
    }
    return kind + (parts.length ? " (" + parts.join(", ") + ")" : "");
  }

  function emit(kind, extra) {
    extra = extra || {};
    var sc = Object.assign({}, extra, { kind: kind });
    var params = { structuredContent: sc };
    var label = typeof extra.label === "string" && extra.label ? extra.label : "";
    var text = label || __contentText(kind, extra);
    if (text) params.content = [{ type: "text", text: text }];

    // ── ChatGPT (OpenAI Apps SDK) ──────────────────────────────────────────
    // Absent in the AIPLA app / Claude → whole block no-ops. Guard every call.
    var oa = typeof window !== "undefined" ? window.openai : undefined;
    if (oa) {
      try {
        if (oa.setWidgetState) oa.setWidgetState(sc);
      } catch (e) {
        /* best effort */
      }
      // Inject a turn ONLY on a deliberate commit (has a curated label) — never
      // on a passive settle or a derived-text event. Gated on `label`, NOT on
      // `content` (content is near-always present via __contentText).
      if (label && oa.sendFollowUpMessage) {
        try {
          oa.sendFollowUpMessage({ prompt: label });
        } catch (e) {
          /* best effort */
        }
      }
    }

    // ── SEP-1865 postMessage (AIPLA app + native hosts) — authoritative ─────
    var msg = { jsonrpc: "2.0", method: "ui/update-model-context", params: params };
    if (!__initialized) {
      __pendingEmits.push(msg);
      return;
    }
    __post(msg);
  }

  function onHostNotification(method, cb) {
    if (!__handlers[method]) __handlers[method] = [];
    __handlers[method].push(cb);
  }

  function onChatFlush(cb) {
    onHostNotification("ui/notifications/chat-flush", function () {
      cb();
    });
  }

  function init(clientInfo) {
    var ci = {
      name: (clientInfo && clientInfo.name) || "aipla-sim",
      version: (clientInfo && clientInfo.version) || "1.0.0",
    };
    // If parent isn't a sandbox proxy (standalone testing) this rejects and we
    // flip __initialized so queued emits stop queuing (they become __post
    // no-ops via the try/catch).
    rpcRequest("ui/initialize", {
      protocolVersion: "2026-01-26",
      capabilities: {},
      clientInfo: ci,
    })
      .then(function (result) {
        __hostContext = (result && result.hostContext) || null;
        rpcNotify("ui/notifications/initialized", { clientInfo: ci });
        __initialized = true;
        while (__pendingEmits.length) __post(__pendingEmits.shift());
      })
      .catch(function () {
        __initialized = true;
        __pendingEmits.length = 0;
      });
  }

  window.AIPLA_BRIDGE = {
    emit: emit,
    init: init,
    onChatFlush: onChatFlush,
    onHostNotification: onHostNotification,
    hostContext: function () {
      return __hostContext;
    },
  };
})();
