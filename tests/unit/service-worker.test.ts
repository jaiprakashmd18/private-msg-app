/**
 * Runs public/sw.js in a simulated service-worker environment and checks
 * what the user would see when a push arrives or a notification is tapped.
 */
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

type Handler = (event: Record<string, unknown>) => void;

function loadServiceWorker(
  windows: { url: string; focused: boolean; visibilityState: string }[] = [],
  fetchImpl: (...args: unknown[]) => Promise<unknown> = async () => new Response("{}"),
) {
  const handlers: Record<string, Handler> = {};
  const showNotification = vi.fn(async () => undefined);
  const openWindow = vi.fn(async () => undefined);
  const navigate = vi.fn(async () => undefined);
  const clientWindows = windows.map((w) => ({ ...w, focus: vi.fn(async () => ({ navigate })) }));
  const self = {
    location: { origin: "https://app.example" },
    addEventListener: (type: string, fn: Handler) => (handlers[type] = fn),
    registration: { showNotification },
    clients: { matchAll: vi.fn(async () => clientWindows), openWindow, claim: vi.fn() },
    skipWaiting: vi.fn(),
  };
  runInNewContext(readFileSync("public/sw.js", "utf8"), { self, caches: {}, fetch: fetchImpl, URL, Response, Promise });

  async function dispatch(type: string, extra: Record<string, unknown>) {
    let pending: Promise<unknown> = Promise.resolve();
    handlers[type]!({ ...extra, waitUntil: (p: Promise<unknown>) => (pending = p) });
    await pending;
  }
  return { dispatch, showNotification, openWindow, navigate, clientWindows };
}

const pushEvent = (payload: object) => ({ data: { json: () => payload, text: () => JSON.stringify(payload) } });

describe("service worker notifications", () => {
  it("shows a notification with the sender, text and a link to the chat", async () => {
    const sw = loadServiceWorker();
    await sw.dispatch("push", pushEvent({ title: "Alex", body: "Dinner at 8?", url: "/chat/c1", tag: "c1" }));
    expect(sw.showNotification).toHaveBeenCalledWith(
      "Alex",
      expect.objectContaining({ body: "Dinner at 8?", tag: "c1", data: { url: "/chat/c1" }, icon: "/icons/icon-192.png" }),
    );
  });

  it("stays quiet when that conversation is already open on screen", async () => {
    const sw = loadServiceWorker([{ url: "https://app.example/chat/c1", focused: true, visibilityState: "visible" }]);
    await sw.dispatch("push", pushEvent({ title: "Alex", body: "hi", url: "/chat/c1", tag: "c1" }));
    expect(sw.showNotification).not.toHaveBeenCalled();
  });

  it("still notifies when a different chat is open", async () => {
    const sw = loadServiceWorker([{ url: "https://app.example/chat/other", focused: true, visibilityState: "visible" }]);
    await sw.dispatch("push", pushEvent({ title: "Alex", body: "hi", url: "/chat/c1", tag: "c1" }));
    expect(sw.showNotification).toHaveBeenCalled();
  });

  it("tapping a notification opens the chat (reusing an open app window)", async () => {
    const close = vi.fn();
    const fresh = loadServiceWorker();
    await fresh.dispatch("notificationclick", { notification: { close, data: { url: "/chat/c1" } } });
    expect(close).toHaveBeenCalled();
    expect(fresh.openWindow).toHaveBeenCalledWith("https://app.example/chat/c1");

    const open = loadServiceWorker([{ url: "https://app.example/settings", focused: false, visibilityState: "hidden" }]);
    await open.dispatch("notificationclick", { notification: { close, data: { url: "/chat/c1" } } });
    expect(open.clientWindows[0]!.focus).toHaveBeenCalled();
    expect(open.navigate).toHaveBeenCalledWith("https://app.example/chat/c1");
    expect(open.openWindow).not.toHaveBeenCalled();
  });
});

describe("delivery receipts from notifications", () => {
  it("tells the server the message reached this phone (✓✓ for the sender)", async () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    const sw = loadServiceWorker([], fetchMock);
    const id = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
    await sw.dispatch("push", pushEvent({ title: "Alex", body: "Hi", url: `/chat/${id}`, tag: id }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/push/delivered",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ conversationId: id }) }),
    );
    expect(sw.showNotification).toHaveBeenCalled();
  });

  it("still shows the notification when that request fails", async () => {
    const sw = loadServiceWorker([], async () => Promise.reject(new Error("offline")));
    await sw.dispatch("push", pushEvent({ title: "Alex", body: "Hi", url: "/chat/3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d" }));
    expect(sw.showNotification).toHaveBeenCalled();
  });
});
