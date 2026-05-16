/// <reference path="../../typings/plugin.d.ts" />
/// <reference path="../../typings/system.d.ts" />
/// <reference path="../../typings/app.d.ts" />
/// <reference path="../../typings/core.d.ts" />

type MediaType = "anime" | "manga";
type SyncAction = "update" | "progress" | "repeat" | "delete";
type FuzzyDate = { day?: number; month?: number; year?: number };
type AniListEntry = {
  id: number;
  media?: ($app.AL_BaseAnime | $app.AL_BaseManga) & { idMal?: number };
  notes?: string;
  private?: boolean;
  progress?: number;
  repeat?: number;
  score?: number;
  startedAt?: FuzzyDate;
  completedAt?: FuzzyDate;
  status?: $app.AL_MediaListStatus;
};
type AsunaPayload = {
  media_type: MediaType;
  mal_id: number;
  status?: string;
  progress?: number;
  repeat_count?: number;
  score?: number;
  notes?: string;
  start_date?: string;
  finish_date?: string;
};
type Notice = {
  id: string;
  title: string;
  image?: string;
  unread: boolean;
  timestamp: number;
  details: Record<string, string | number | boolean | undefined>;
};

// @ts-ignore
function init() {
  const KEY = {
    preUpdate: "asunatracks-sync:pre-update",
    postUpdate: "asunatracks-sync:post-update",
    preProgress: "asunatracks-sync:pre-progress",
    postProgress: "asunatracks-sync:post-progress",
    preRepeat: "asunatracks-sync:pre-repeat",
    postRepeat: "asunatracks-sync:post-repeat",
    postDelete: "asunatracks-sync:post-delete",
  };

  $ui.register((ctx) => {
    const tray = ctx.newTray({
      iconUrl: "https://asunatracks.space/static/asunatracks-logo.png",
      withContent: true,
      width: "30rem",
    });

    const fields = {
      baseUrl: ctx.fieldRef<string>($storage.get("asunatracks-sync:base-url") ?? "https://asunatracks.space"),
      username: ctx.fieldRef<string>(""),
      password: ctx.fieldRef<string>(""),
      disableLiveSync: ctx.fieldRef<boolean>($storage.get("asunatracks-sync:disable-live-sync")?.valueOf() ?? false),
      skipAdult: ctx.fieldRef<boolean>($storage.get("asunatracks-sync:skip-adult")?.valueOf() ?? true),
      suppressBadge: ctx.fieldRef<boolean>($storage.get("asunatracks-sync:suppress-badge")?.valueOf() ?? false),
    };

    const state = {
      token: ctx.state<string | null>($storage.get("asunatracks-sync:token") ?? null),
      user: ctx.state<any | null>($storage.get("asunatracks-sync:user") ?? null),
      busy: ctx.state<boolean>(false),
      status: ctx.state<string>("Ready"),
      lastError: ctx.state<string | null>(null),
      success: ctx.state<number>($storage.get("asunatracks-sync:success-count") ?? 0),
      fail: ctx.state<number>($storage.get("asunatracks-sync:fail-count") ?? 0),
    };

    const logs = {
      id: "asunatracks-sync:logs",
      open: ctx.state<boolean>(false),
      push(level: "Info" | "Success" | "Warning" | "Error", message: string) {
        const rows = ($storage.get<[string, string][]>(this.id) ?? []).slice(-199);
        rows.push([`${new Date().toISOString().slice(0, 19)} | ${level.padEnd(7, " ")} | ${message}`, level]);
        $storage.set(this.id, rows);
      },
      entries() {
        return this.open.get() ? ($storage.get<[string, string][]>(this.id) ?? []) : [];
      },
      clear() {
        $storage.set(this.id, []);
        this.push("Info", "Log cleared");
      },
    };

    const notices = {
      id: "asunatracks-sync:notifications",
      open: ctx.state<boolean>(false),
      unread: ctx.state<number>(($storage.get<Notice[]>("asunatracks-sync:notifications") ?? []).filter((n) => n.unread).length),
      entries() {
        return this.open.get() ? ($storage.get<Notice[]>(this.id) ?? []) : [];
      },
      push(entry: Omit<Notice, "id" | "timestamp" | "unread">) {
        const rows = ($storage.get<Notice[]>(this.id) ?? []).slice(-49);
        rows.push({ ...entry, id: `${Date.now()}-${Math.random()}`, timestamp: Date.now(), unread: true });
        $storage.set(this.id, rows);
        this.unread.set(rows.filter((n) => n.unread).length);
      },
      markAllRead() {
        $storage.set(this.id, ($storage.get<Notice[]>(this.id) ?? []).map((n) => ({ ...n, unread: false })));
        this.unread.set(0);
      },
      deleteAll() {
        $storage.set(this.id, []);
        this.unread.set(0);
      },
    };

    function cleanBaseUrl() {
      let value = String(fields.baseUrl.current || "https://asunatracks.space").trim();
      if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
      return value.replace(/\/+$/, "");
    }

    function setToken(token: string | null, user: any | null = null) {
      $storage.set("asunatracks-sync:token", token);
      $storage.set("asunatracks-sync:user", user);
      state.token.set(token);
      state.user.set(user);
    }

    function absoluteUrl(value?: string | null) {
      if (!value) return "";
      if (/^https?:\/\//i.test(value)) return value;
      return `${cleanBaseUrl()}${String(value).startsWith("/") ? value : `/${value}`}`;
    }

    function unwrap<T>(value: T | null | undefined): T | undefined {
      if (value == null) return undefined;
      if (typeof value === "object") {
        const v = (value as any).valueOf?.();
        return v == null ? undefined : v;
      }
      return value;
    }

    function updateCounters(ok: boolean) {
      const key = ok ? "success" : "fail";
      const next = state[key].get() + 1;
      state[key].set(next);
      $storage.set(`asunatracks-sync:${ok ? "success" : "fail"}-count`, next);
    }

    async function api(path: string, init: RequestInit = {}) {
      const headers: Record<string, string> = { "Content-Type": "application/json", ...((init.headers as Record<string, string>) ?? {}) };
      const token = state.token.get();
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await ctx.fetch(`${cleanBaseUrl()}${path}`, { ...init, headers } as FetchOptions);
      updateCounters(res.ok);
      if (!res.ok) {
        let message = res.statusText;
        try {
          const body = await res.json();
          message = body?.error || body?.message || message;
        } catch {}
        if (res.status === 401) setToken(null, null);
        throw new Error(message || `Request failed (${res.status})`);
      }
      return res;
    }

    async function login() {
      state.busy.set(true);
      state.lastError.set(null);
      state.status.set("Signing in...");
      try {
        $storage.set("asunatracks-sync:base-url", cleanBaseUrl());
        const res = await api("/public/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ username: fields.username.current, password: fields.password.current }),
        });
        const data = await res.json();
        setToken(data.token, data.user ?? null);
        fields.password.setValue("");
        state.status.set(`Signed in as ${data.user?.username ?? "AsunaTracks"}`);
        logs.push("Success", "Signed in to AsunaTracks");
        ctx.toast.success("Signed in to AsunaTracks");
      } catch (err) {
        state.lastError.set((err as Error).message);
        state.status.set("Sign in failed");
        logs.push("Error", `Sign in failed: ${(err as Error).message}`);
      } finally {
        state.busy.set(false);
      }
    }

    async function logout() {
      state.busy.set(true);
      try {
        if (state.token.get()) await api("/public/api/auth/logout", { method: "POST" }).catch(() => undefined);
        setToken(null, null);
        state.status.set("Signed out");
        logs.push("Info", "Signed out");
        ctx.toast.info("Signed out of AsunaTracks Sync");
      } finally {
        state.busy.set(false);
      }
    }

    function toISODate(date?: FuzzyDate) {
      const year = unwrap(date?.year);
      if (!year) return undefined;
      return new Date(Date.UTC(year, unwrap(date?.month) ?? 1, unwrap(date?.day) ?? 1)).toISOString().substring(0, 10);
    }

    function statusFor(type: MediaType, status?: $app.AL_MediaListStatus) {
      if (!status) return undefined;
      const anime: Record<$app.AL_MediaListStatus, string> = { CURRENT: "watching", PLANNING: "planning", COMPLETED: "completed", DROPPED: "dropped", PAUSED: "paused", REPEATING: "rewatching" };
      const manga: Record<$app.AL_MediaListStatus, string> = { CURRENT: "reading", PLANNING: "planning", COMPLETED: "completed", DROPPED: "dropped", PAUSED: "paused", REPEATING: "rereading" };
      return type === "anime" ? anime[status] : manga[status];
    }

    function anilistEntries(type: MediaType): AniListEntry[] {
      const collection = type === "anime" ? $anilist.getAnimeCollection(false).MediaListCollection : $anilist.getMangaCollection(false).MediaListCollection;
      return (collection?.lists ?? []).flatMap((list) => list.entries ?? []).filter((entry): entry is AniListEntry => !!entry && (entry.media?.id ?? 0) < 2 ** 31);
    }

    async function mediaForEvent(mediaId?: number): Promise<{ type: MediaType; entry: AniListEntry } | null> {
      if (!mediaId) return null;
      try {
        const anime = await ctx.anime.getAnimeEntry(mediaId);
        const entry = anilistEntries("anime").find((item) => item.media?.id === mediaId || item.id === anime.listData?.id);
        if (entry) return { type: "anime", entry };
      } catch {}
      const manga = anilistEntries("manga").find((item) => item.media?.id === mediaId);
      return manga ? { type: "manga", entry: manga } : null;
    }

    function payloadFromEntry(type: MediaType, entry: AniListEntry, overrides: Partial<AsunaPayload> = {}): AsunaPayload | null {
      const malId = unwrap(entry.media?.idMal);
      if (!malId) return null;
      return {
        media_type: type,
        mal_id: malId,
        status: statusFor(type, entry.status),
        progress: unwrap(entry.progress) ?? 0,
        repeat_count: unwrap(entry.repeat) ?? 0,
        score: unwrap(entry.score),
        notes: unwrap(entry.notes),
        start_date: toISODate(entry.startedAt),
        finish_date: toISODate(entry.completedAt),
        ...overrides,
      };
    }

    function niceKey(value: string) {
      return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
    }

    function time(t: number) {
      const d = new Date(t);
      return `${d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" })} ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
    }

    function notify(title: string, entry: AniListEntry, details: Notice["details"]) {
      notices.push({ title, image: entry.media?.coverImage?.large ?? entry.media?.coverImage?.medium, details });
    }

    async function pushEntry(type: MediaType, entry: AniListEntry, reason: string, overrides: Partial<AsunaPayload> = {}) {
      if (!state.token.get()) return logs.push("Warning", `${reason}: skipped because AsunaTracks is not signed in`);
      if (fields.skipAdult.current.valueOf() && entry.media?.isAdult?.valueOf()) return logs.push("Warning", `${reason}: skipped adult entry`);
      if (unwrap(entry.private)) return logs.push("Warning", `${reason}: skipped private entry`);
      const body = payloadFromEntry(type, entry, overrides);
      if (!body) return logs.push("Warning", `${reason}: skipped ${entry.media?.title?.userPreferred ?? entry.media?.id} because it has no MAL ID`);
      await api("/public/api/me/list", { method: "POST", body: JSON.stringify(body) });
      const title = entry.media?.title?.userPreferred ?? String(body.mal_id);
      logs.push("Success", `${reason}: synced ${title}`);
      notify(`Updated ${title}`, entry, { Action: reason, Type: type, Status: body.status, Progress: body.progress, Score: body.score, Repeat: body.repeat_count });
    }

    async function removeEntry(type: MediaType, entry: AniListEntry, reason: string) {
      const malId = unwrap(entry.media?.idMal);
      if (!state.token.get() || !malId) return;
      await api("/public/api/me/list/remove", { method: "POST", body: JSON.stringify({ media_type: type, mal_id: malId }) });
      const title = entry.media?.title?.userPreferred ?? String(malId);
      logs.push("Success", `${reason}: removed ${title}`);
      notify(`Removed ${title}`, entry, { Action: reason, Type: type, Status: "Deleted" });
    }

    async function liveSync<T extends { mediaId?: number; status?: $app.AL_MediaListStatus; progress?: number; repeat?: number; scoreRaw?: number; startedAt?: FuzzyDate; completedAt?: FuzzyDate }>(
      action: SyncAction,
      event: { mediaId?: number },
      preDataKey: string,
      overrides: (data: T, type: MediaType) => Partial<AsunaPayload>,
    ) {
      if (fields.disableLiveSync.current.valueOf()) return logs.push("Info", `${action}: live sync is disabled`);
      const data = $store.get(preDataKey) as T | null;
      $store.set(preDataKey, null);
      if (!data || data.mediaId !== event.mediaId) return logs.push("Warning", `${action}: missing pre-update payload`);
      const target = await mediaForEvent(event.mediaId);
      if (!target) return logs.push("Warning", `${action}: media not found (${event.mediaId ?? "unknown"})`);
      try {
        await pushEntry(target.type, target.entry, action, overrides(data, target.type));
        state.status.set(`Last sync: ${target.entry.media?.title?.userPreferred ?? target.entry.media?.id}`);
      } catch (err) {
        state.lastError.set((err as Error).message);
        logs.push("Error", `${action}: ${(err as Error).message}`);
      }
    }

    async function liveDelete(event: { mediaId?: number }) {
      if (fields.disableLiveSync.current.valueOf()) return;
      const target = await mediaForEvent(event.mediaId);
      if (!target) return logs.push("Warning", `delete: media not found (${event.mediaId ?? "unknown"})`);
      try {
        await removeEntry(target.type, target.entry, "delete");
      } catch (err) {
        state.lastError.set((err as Error).message);
        logs.push("Error", `delete: ${(err as Error).message}`);
      }
    }

    async function manualSync(type: MediaType) {
      state.busy.set(true);
      state.lastError.set(null);
      const entries = anilistEntries(type).filter((entry) => !unwrap(entry.private));
      let synced = 0;
      let skipped = 0;
      state.status.set(`Syncing ${type}...`);
      logs.push("Info", `Manual ${type} sync started with ${entries.length} AniList entries`);
      for (const entry of entries) {
        if (!state.busy.get()) break;
        try {
          if (!entry.media?.idMal) {
            skipped++;
            continue;
          }
          await pushEntry(type, entry, "manual");
          synced++;
          await new Promise((resolve) => ctx.setTimeout(resolve, 500));
        } catch (err) {
          skipped++;
          logs.push("Error", `manual: ${(err as Error).message}`);
          await new Promise((resolve) => ctx.setTimeout(resolve, 1000));
        }
      }
      state.status.set(`Manual ${type} sync finished: ${synced} synced, ${skipped} skipped`);
      ctx.toast.success(`AsunaTracks ${type} sync finished`);
      state.busy.set(false);
    }

    function textInput(label: string, fieldRef: $ui.FieldRef<string>, placeholder: string, password = false) {
      return tray.input({ label, placeholder, fieldRef, type: password ? "password" : "text", disabled: state.busy.get() } as any);
    }

    function square(label: string, tooltip: string, onClick: string, disabled = false) {
      return tray.tooltip(
        tray.button(label, { intent: "gray-subtle", size: "md", disabled, onClick, className: "h-10 rounded-md bg-[#202a4b] border border-[#26335b] p-0 text-xs font-bold text-[#d6dcff]", style: { width: "64px" } }),
        { text: tooltip },
      );
    }

    function logsModal(trigger: any) {
      return tray.modal({
        trigger,
        title: "AsunaTracks Sync Logs",
        className: "max-w-4xl",
        onOpenChange: ctx.eventHandler("asunatracks-sync:logs-open", ({ open }) => logs.open.set(open)),
        items: [
          tray.button("Clear", { intent: "gray-subtle", size: "md", className: "w-fit", onClick: ctx.eventHandler("asunatracks-sync:logs-clear", () => logs.clear()) }),
          tray.div(
            logs.entries().length
              ? logs.entries().map(([message, level], i) => tray.text(message, { className: `font-mono text-sm whitespace-pre-wrap break-all px-2 py-1 ${level === "Error" ? "text-red-200" : level === "Success" ? "text-green-200" : level === "Warning" ? "text-orange-200" : "text-[--muted]"} ${i % 2 === 0 ? "bg-gray-900" : "bg-gray-800"}` }))
              : [tray.text("No logs yet.", { className: "text-center p-5 text-[--muted]" })],
            { className: "max-h-[34rem] overflow-y-auto border rounded-lg bg-gray-950" },
          ),
        ],
      });
    }

    function noticesModal(trigger: any) {
      return tray.modal({
        trigger,
        title: "AsunaTracks Sync Notifications",
        className: "max-w-3xl bg-[#10172f]",
        onOpenChange: ctx.eventHandler("asunatracks-sync:notices-open", ({ open }) => notices.open.set(open)),
        items: [
          tray.flex([
            tray.button("Mark all as Read", { intent: "gray-subtle", size: "md", className: "w-fit bg-[#172142] border border-[#26355f]", disabled: notices.unread.get() <= 0, onClick: ctx.eventHandler("asunatracks-sync:notices-read", () => notices.markAllRead()) }),
            tray.button("Delete all", { intent: "alert-subtle", size: "md", className: "w-fit", disabled: notices.entries().length <= 0, onClick: ctx.eventHandler("asunatracks-sync:notices-delete", () => notices.deleteAll()) }),
          ]),
          tray.div(
            notices.entries().length
              ? notices.entries().slice().reverse().map((entry) => tray.div([
                  entry.unread ? tray.div([], { className: "absolute w-3 h-3 rounded-full bg-red-500 border border-white", style: { right: "-0.25rem", top: "-0.25rem" } }) : [],
                  tray.flex([
                    entry.image ? tray.img({ src: entry.image, width: "52px", className: "rounded-md shrink-0" }) : tray.div([], { className: "w-[52px] h-[70px] rounded-md bg-[#202a4b] shrink-0" }),
                    tray.div([
                      tray.text(entry.title, { className: "font-bold text-base text-[#eef3ff] line-clamp-1" }),
                      tray.div(Object.entries(entry.details).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => tray.p([tray.span(`${niceKey(k)}: `, { className: "text-[#7f8ab8] text-xs" }), tray.span(String(v), { className: "font-bold text-[#e6ebff] text-xs" })])), { className: "grid grid-cols-2 gap-x-4" }),
                      tray.text(time(entry.timestamp), { className: "text-xs text-[#7f8ab8] mt-1" }),
                    ], { className: "flex-1" }),
                  ], { className: "items-start gap-3" }),
                ], { className: "relative p-3 rounded-md border bg-[#172142] border-[#2d3d6f] mb-2" }))
              : [tray.text("No Notifications", { className: "text-center p-5 text-[#7f8ab8] border rounded-md bg-[#172142]" })],
            { className: "max-h-[30rem] overflow-y-auto mt-2 pr-1" },
          ),
        ],
      });
    }

    function settingsModal(trigger: any, signedIn: boolean) {
      return tray.modal({
        trigger,
        title: "AsunaTracks Sync Settings",
        className: "max-w-lg",
        items: [
          textInput("AsunaTracks URL", fields.baseUrl, "https://asunatracks.space"),
          signedIn
            ? tray.button("Sign out", { intent: "alert-subtle", size: "md", loading: state.busy.get(), onClick: ctx.eventHandler("asunatracks-sync:logout", logout) })
            : [textInput("Username", fields.username, "username or email"), textInput("Password", fields.password, "password", true), tray.button("Sign in", { intent: "primary", size: "md", loading: state.busy.get(), onClick: ctx.eventHandler("asunatracks-sync:login", login) })],
        ],
      });
    }

    const ui = {
      render() {
        const signedIn = !!state.token.get();
        const user = state.user.get();
        const username = user?.username ?? user?.display_name ?? "Username";
        const total = state.success.get() + state.fail.get();
        const successRate = total ? ((state.success.get() / total) * 100).toFixed(2) : "0.00";
        const lastState = state.lastError.get() ? `Failed (${state.lastError.get()})` : state.status.get();
        const error = state.lastError.get() ? tray.text(state.lastError.get() ?? "", { className: "break-normal bg-red-500/20 text-red-100 text-xs border border-red-400/30 rounded-md px-2 py-1 line-clamp-2" }) : [];
        const noticeTrigger = noticesModal(tray.button(`Bell${notices.unread.get() ? ` ${notices.unread.get()}` : ""}`, { intent: "gray-subtle", size: "md", onClick: ctx.eventHandler("asunatracks-sync:notices-trigger", () => undefined), className: "h-8 rounded-full bg-transparent border-0 p-0 text-xs font-bold text-[#f4b86a]", style: { width: "42px" } }));
        const logTrigger = logsModal(tray.button("</>", { intent: "gray-subtle", size: "md", onClick: ctx.eventHandler("asunatracks-sync:logs-trigger", () => undefined), className: "h-10 rounded-md bg-[#202a4b] border border-[#26335b] p-0 text-xs font-bold text-[#d6dcff]", style: { width: "64px" } }));
        const profileHref = signedIn && username ? `${cleanBaseUrl()}/u/${encodeURIComponent(username)}` : `${cleanBaseUrl()}/login`;
        const avatarUrl = absoluteUrl(user?.avatar_url);
        const profileTrigger = tray.button(avatarUrl ? " " : "PFP", { intent: "gray-subtle", size: "md", onClick: ctx.eventHandler("asunatracks-sync:profile-trigger", () => undefined), className: "h-8 rounded-full bg-[#202a4b] border border-[#26355f] bg-center bg-cover bg-no-repeat p-0 text-xs font-bold text-[#d6dcff]", style: { width: "32px", backgroundImage: avatarUrl ? `url(${avatarUrl})` : "" } });
        const profileSettings = settingsModal(tray.dropdownMenuItem([tray.span(signedIn ? "Settings" : "Sign in")], { onClick: ctx.eventHandler("asunatracks-sync:profile-settings", () => undefined) }), signedIn);
        const profileMenu = tray.dropdownMenu({
          trigger: profileTrigger,
          items: [profileSettings, tray.dropdownMenuItem([tray.a({ items: [tray.span("Open in browser")], href: profileHref, className: "no-underline" })], { disabled: !signedIn }), tray.dropdownMenuItem([tray.span("Sign out")], { className: "text-[--red]", disabled: !signedIn, onClick: ctx.eventHandler("asunatracks-sync:profile-signout", logout) })],
        });

        return tray.div([
          tray.flex([tray.div([tray.text("AsunaTracks", { className: "font-extrabold text-2xl leading-none text-[#e6ebff]" }), tray.text("for Seanime", { className: "text-xs font-semibold text-[#7f8ab8] mt-1" })], { className: "flex-1" }), tray.flex([noticeTrigger, profileMenu], { className: "items-start gap-1" })], { className: "items-start" }),
          tray.div([tray.text("Welcome,", { className: "font-bold text-xs text-[#eef3ff]" }), tray.text(signedIn ? username : "Sign in", { className: "font-extrabold text-2xl leading-none text-[#eef3ff] line-clamp-1" })], { className: "rounded-sm bg-[#315094] px-3 py-3 mt-3 mb-3" }),
          error,
          tray.flex([
            logTrigger,
            square("Sync", "Check account", ctx.eventHandler("asunatracks-sync:me", async () => {
              state.busy.set(true);
              try {
                const res = await api("/public/api/me");
                const data = await res.json();
                setToken(state.token.get(), data.user ?? null);
                state.status.set("Success (200)");
                state.lastError.set(null);
                ctx.toast.success("AsunaTracks account check passed");
              } catch (err) {
                state.lastError.set((err as Error).message);
              } finally {
                state.busy.set(false);
              }
            }), !signedIn),
            square("Anime", "Sync Anime", ctx.eventHandler("asunatracks-sync:manual-anime", () => manualSync("anime")), !signedIn),
            square("Manga", "Sync Manga", ctx.eventHandler("asunatracks-sync:manual-manga", () => manualSync("manga")), !signedIn),
          ], { className: "grid grid-cols-4 gap-2 mb-3" }),
          tray.div([
            tray.switch("Temporarily disable livesync", { fieldRef: fields.disableLiveSync, disabled: !signedIn, onChange: ctx.eventHandler("asunatracks-sync:disable-live", ({ value }) => $storage.set("asunatracks-sync:disable-live-sync", value)) }),
            tray.switch("Skip adult entries for livesync", { fieldRef: fields.skipAdult, disabled: !signedIn, onChange: ctx.eventHandler("asunatracks-sync:skip-adult", ({ value }) => $storage.set("asunatracks-sync:skip-adult", value)) }),
            tray.switch("Disable badge for non-critical notifications", { fieldRef: fields.suppressBadge, onChange: ctx.eventHandler("asunatracks-sync:suppress-badge", ({ value }) => $storage.set("asunatracks-sync:suppress-badge", value)) }),
          ], { className: "font-bold text-sm text-[#dbe4ff] space-y-2" }),
          tray.div([], { className: "h-14" }),
          tray.div([tray.text(`Connections made: ${total}`, { className: "text-[10px] leading-tight text-[#b7c0e6]" }), tray.text(`Successful connections: ${state.success.get()} (${successRate}%)`, { className: "text-[10px] leading-tight text-[#b7c0e6]" }), tray.p([tray.span("Last connection: ", { className: "text-[#b7c0e6]" }), tray.span(lastState, { className: state.lastError.get() ? "text-red-300" : "text-green-300" })], { className: "text-[10px] leading-tight" })], { className: "mt-4" }),
          tray.flex([tray.anchor("Privacy Policy", { href: "https://asunatracks.space/info/privacy", className: "no-underline hover:underline text-[#b7c0e6]" }), tray.span("|", { className: "text-[#6070a8]" }), tray.anchor("Terms", { href: "https://asunatracks.space/info/terms", className: "no-underline hover:underline text-[#b7c0e6]" })], { className: "justify-center text-xs mt-2 gap-2" }),
        ], { className: "m-1 p-3 rounded-md border bg-[#10172f] text-[#e7ecff]", style: { borderColor: "#26355f", minHeight: "22rem" } });
      },
    };

    $store.watch<$app.PostUpdateEntryEvent>(KEY.postUpdate, (event) => liveSync<$app.PreUpdateEntryEvent>("update", event, KEY.preUpdate, (data, type) => ({ status: statusFor(type, data.status), progress: data.progress, score: typeof data.scoreRaw === "number" ? data.scoreRaw : undefined, start_date: toISODate(data.startedAt), finish_date: toISODate(data.completedAt) })));
    $store.watch<$app.PostUpdateEntryProgressEvent>(KEY.postProgress, (event) => liveSync<$app.PreUpdateEntryProgressEvent>("progress", event, KEY.preProgress, (data, type) => ({ status: statusFor(type, data.progress && data.progress === data.totalCount ? "COMPLETED" : data.status), progress: data.progress })));
    $store.watch<$app.PostUpdateEntryRepeatEvent>(KEY.postRepeat, (event) => liveSync<$app.PreUpdateEntryRepeatEvent>("repeat", event, KEY.preRepeat, (data) => ({ repeat_count: data.repeat })));
    $store.watch<$app.PostDeleteEntryEvent>(KEY.postDelete, liveDelete);

    tray.render(() => ui.render());
    ctx.effect(() => {
      if (!state.token.get()) return tray.updateBadge({ number: 1, intent: "error" });
      if (state.busy.get() && !fields.suppressBadge.current.valueOf()) return tray.updateBadge({ number: 1, intent: "warning" });
      return tray.updateBadge({ number: 0 });
    }, [state.token, state.busy, notices.unread]);

    if (state.token.get()) {
      api("/public/api/me")
        .then((res) => res.json())
        .then((data) => {
          setToken(state.token.get(), data.user ?? state.user.get());
          state.status.set(`Signed in${data.user?.username ? ` as ${data.user.username}` : ""}`);
          logs.push("Success", "Existing AsunaTracks token is valid");
        })
        .catch((err) => {
          state.lastError.set((err as Error).message);
          state.status.set("Please sign in again");
          logs.push("Error", `Token check failed: ${(err as Error).message}`);
        });
    }
  });

  $app.onPreUpdateEntry((event) => {
    $store.set("asunatracks-sync:pre-update", $clone(event));
    event.next();
  });
  $app.onPostUpdateEntry((event) => {
    $store.set("asunatracks-sync:post-update", $clone(event));
    event.next();
  });
  $app.onPreUpdateEntryProgress((event) => {
    $store.set("asunatracks-sync:pre-progress", $clone(event));
    event.next();
  });
  $app.onPostUpdateEntryProgress((event) => {
    $store.set("asunatracks-sync:post-progress", $clone(event));
    event.next();
  });
  $app.onPreUpdateEntryRepeat((event) => {
    $store.set("asunatracks-sync:pre-repeat", $clone(event));
    event.next();
  });
  $app.onPostUpdateEntryRepeat((event) => {
    $store.set("asunatracks-sync:post-repeat", $clone(event));
    event.next();
  });
  $app.onPostDeleteEntry((event) => {
    $store.set("asunatracks-sync:post-delete", $clone(event));
    event.next();
  });
}
