import { DurableObject } from "cloudflare:workers";
import { defaultState, applyAction, decorateState } from "./model.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS
  });
}

function eventId(env) {
  return env.EVENT_ID || "beac-sportnap";
}

function archiveKey(env) {
  return `archive:${eventId(env)}`;
}

function getRoom(env) {
  const id = env.ROOM.idFromName(eventId(env));
  return env.ROOM.get(id);
}

function isAdmin(request, env) {
  const configured = String(env.ADMIN_PIN || "");
  const supplied = String(request.headers.get("x-admin-pin") || "");
  return configured.length >= 4 && supplied === configured;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/login" && request.method === "POST") {
      if (!env.ADMIN_PIN) {
        return json({
          ok: false,
          error: "Az ADMIN_PIN secret még nincs beállítva Cloudflare-ben."
        }, 503);
      }

      return isAdmin(request, env)
        ? json({ ok: true })
        : json({ ok: false, error: "Hibás PIN." }, 401);
    }

    if (url.pathname === "/api/state" && request.method === "GET") {
      const archived = await env.ARCHIVE.get(archiveKey(env), "json");

      if (archived && ["ARCHIVED", "CLOSED"].includes(archived.eventStatus)) {
        return json({
          ok: true,
          state: archived,
          source: "archive-kv"
        });
      }

      const stub = getRoom(env);
      return stub.fetch(new Request("https://room/state"));
    }

    if (url.pathname === "/api/action" && request.method === "POST") {
      if (!isAdmin(request, env)) {
        return json({ ok: false, error: "Nincs jogosultság." }, 401);
      }

      let action;
      try {
        action = await request.json();
      } catch {
        return json({ ok: false, error: "Hibás kérés." }, 400);
      }

      if (!action.actionId) action.actionId = crypto.randomUUID();

      const stub = getRoom(env);
      return stub.fetch(new Request("https://room/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action)
      }));
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({
        ok: true,
        service: "BEAC Sportnap Volleyball Realtime Beta",
        backupConfigured: Boolean(env.BACKUP_URL && env.BACKUP_TOKEN)
      });
    }

    if (url.pathname === "/ws") {
      const upgrade = request.headers.get("Upgrade");

      if (!upgrade || upgrade.toLowerCase() !== "websocket") {
        return new Response("Expected websocket upgrade", { status: 426 });
      }

      const archived = await env.ARCHIVE.get(archiveKey(env), "json");

      if (archived && archived.eventStatus !== "LIVE") {
        return json({ ok: false, error: "Az esemény nem LIVE." }, 409);
      }

      const stub = getRoom(env);
      // Az eredeti Upgrade requestet adjuk tovább, így a WebSocket handshake
      // minden Cloudflare runtime-verzióban megmarad.
      return stub.fetch(request);
    }

    return env.ASSETS.fetch(request);
  }
};

export class TournamentRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;

    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong")
    );

    this.ctx.blockConcurrencyWhile(async () => {
      const existing = await this.ctx.storage.get("state");
      if (!existing) {
        await this.ctx.storage.put("state", defaultState());
      }
    });
  }

  async getRawState() {
    const state = await this.ctx.storage.get("state");
    if (state) return state;

    const fresh = defaultState();
    await this.ctx.storage.put("state", fresh);
    return fresh;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/state") {
      const state = await this.getRawState();
      return json({ ok: true, state: decorateState(state), source: "durable-object" });
    }

    if (url.pathname === "/ws") {
      const state = await this.getRawState();

      if (state.eventStatus !== "LIVE") {
        return json({ ok: false, error: "Az esemény nem LIVE." }, 409);
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      this.ctx.acceptWebSocket(server, ["public"]);
      server.serializeAttachment({
        id: crypto.randomUUID(),
        connectedAt: Date.now()
      });

      server.send(JSON.stringify({
        type: "STATE",
        state: decorateState(state),
        ackActionId: null
      }));

      return new Response(null, {
        status: 101,
        webSocket: client
      });
    }

    if (url.pathname === "/action" && request.method === "POST") {
      let action;
      try {
        action = await request.json();
      } catch {
        return json({ ok: false, error: "Hibás kérés." }, 400);
      }

      try {
        let duplicate = false;
        let notice = "";

        const nextState = await this.ctx.storage.transaction(async txn => {
          const before = (await txn.get("state")) || defaultState();
          const result = applyAction(before, action, Date.now());
          duplicate = result.duplicate;
          notice = result.notice || "";

          if (!duplicate) {
            await txn.put("state", result.state);
          }

          return result.state;
        });

        await this.afterMutation(action, nextState, duplicate);

        const decorated = decorateState(nextState);

        if (!duplicate) {
          this.broadcast(decorated, action.actionId || null);
        }

        return json({
          ok: true,
          duplicate,
          state: decorated,
          ackActionId: action.actionId || null,
          notice
        });
      } catch (error) {
        return json({
          ok: false,
          error: error?.message || String(error)
        }, 400);
      }
    }

    return new Response("Not found", { status: 404 });
  }

  async afterMutation(action, state, duplicate) {
    if (duplicate) return;

    const status = state.eventStatus;

    if (status === "ARCHIVED" || status === "CLOSED") {
      await this.env.ARCHIVE.put(
        archiveKey(this.env),
        JSON.stringify(decorateState(state))
      );

      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.send(JSON.stringify({
            type: "STATE",
            state: decorateState(state),
            ackActionId: action.actionId || null
          }));
          ws.close(1000, status);
        } catch {}
      }
    } else {
      await this.env.ARCHIVE.delete(archiveKey(this.env));
    }

    if (action.type === "SET_ARCHIVE_AT") {
      if (state.archiveAt) {
        await this.ctx.storage.setAlarm(state.archiveAt);
      } else {
        await this.ctx.storage.deleteAlarm();
      }
    }

    if (
      action.type === "FINISH_ROUND" ||
      action.type === "STOP_ROUND" ||
      action.type === "STOP_MATCH" ||
      action.type === "SET_EVENT_STATUS" ||
      action.type === "CREATE_FINAL"
    ) {
      this.ctx.waitUntil(
        this.sendBackup(action.type, decorateState(state))
      );
    }
  }

  broadcast(state, ackActionId = null) {
    const message = JSON.stringify({
      type: "STATE",
      state,
      ackActionId
    });

    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(message);
      } catch {}
    }
  }

  async alarm() {
    const before = await this.getRawState();

    if (
      before.archiveAt &&
      before.archiveAt <= Date.now() &&
      before.eventStatus === "LIVE"
    ) {
      const action = {
        type: "SET_EVENT_STATUS",
        status: "ARCHIVED",
        actionId: `alarm-${before.archiveAt}`
      };

      const result = applyAction(before, action, Date.now());
      await this.ctx.storage.put("state", result.state);

      const decorated = decorateState(result.state);

      await this.env.ARCHIVE.put(
        archiveKey(this.env),
        JSON.stringify(decorated)
      );

      this.broadcast(decorated, action.actionId);

      for (const ws of this.ctx.getWebSockets()) {
        try { ws.close(1000, "ARCHIVED"); } catch {}
      }

      this.ctx.waitUntil(
        this.sendBackup("AUTO_ARCHIVE", decorated)
      );
    }
  }

  async sendBackup(reason, state) {
    if (!this.env.BACKUP_URL || !this.env.BACKUP_TOKEN) return;

    try {
      await fetch(this.env.BACKUP_URL, {
        method: "POST",
        redirect: "follow",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          token: this.env.BACKUP_TOKEN,
          reason,
          state
        })
      });
    } catch (error) {
      console.error("Backup failed:", error);
    }
  }

  webSocketMessage(ws, message) {
    // A "ping" üzenetet a runtime automatikusan "pong"-gal válaszolja meg.
    // Egyéb kliensüzenetet nem használunk; pontozás csak hitelesített HTTP actionnel megy.
  }

  webSocketClose() {}
  webSocketError() {}
}
