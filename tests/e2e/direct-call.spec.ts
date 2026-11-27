import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import ts from "typescript";
import type { DirectCall, Signal } from "../../src/lib/direct-call";

declare global {
  interface Window {
    call: DirectCall;
    signal: (signal: Signal) => Promise<void>;
  }
}

test.use({ launchOptions: {
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--disable-features=WebRtcHideLocalIpsWithMdns", "--allow-loopback-in-peer-connection"],
} });

for (const scenario of ["voice", "video", "decline"] as const) {
  const mode = scenario === "video" ? "video" : "voice";
  test(`two open browsers handle a ${scenario} call`, async ({ browser, browserName }) => {
    test.skip(browserName !== "chromium", "Uses Chromium test media devices");
    const context = await browser.newContext();
    try {
      const pages = await Promise.all([context.newPage(), context.newPage()]);
      const source = ts.transpile(readFileSync("src/lib/direct-call.ts", "utf8").replace("export class", "class"),
        { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }).replace(/export\s*\{\s*\};?/, "");
      for (const [i, page] of pages.entries()) {
        await page.route("http://localhost:4100/**", route => route.request().url().endsWith("/ice")
          ? route.fulfill({ json: { iceServers: process.env.CALL_TEST_ICE_SERVERS ? JSON.parse(process.env.CALL_TEST_ICE_SERVERS) : [] } })
          : route.fulfill({ contentType: "text/html", body: "<title>Call test</title>" }));
        await page.goto("http://localhost:4100/");
        await page.exposeFunction("signal", (signal: Signal) =>
          pages[1 - i]!.evaluate(s => { void window.call.receive(s); }, signal));
        await page.addScriptTag({ content: source + `
          window.call = new DirectCall((call,event,data='') => window.signal({
            id:call.id, chat:call.chat, sender:'${i}', event, data
          }), () => {}, console.error);
        ` });
      }
      const [a, b] = pages;
      await a.evaluate((mode: "voice" | "video") => window.call.start("chat", "1", mode), mode);
      await expect.poll(() => b.evaluate(() => window.call.current?.phase)).toBe("incoming");
      expect(await b.evaluate(() => !!window.call.current?.local)).toBe(false);
      if (scenario === "decline") {
        await b.evaluate(() => window.call.end());
        await expect.poll(() => a.evaluate(() => window.call.current)).toBeNull();
        return;
      }
      await b.evaluate(() => window.call.accept());
      for (const page of pages) {
        await expect.poll(() => page.evaluate(() => window.call.current?.phase), { timeout: 20000 }).toBe("connected");
        expect(await page.evaluate(() => window.call.current?.remote?.getTracks().length)).toBe(mode === "voice" ? 1 : 2);
      }
      expect(await a.evaluate(() => {
        window.call.toggle("audio");
        return window.call.current?.local?.getAudioTracks()[0]?.enabled;
      })).toBe(false);
      expect(await a.evaluate(() => {
        const tracks = window.call.current!.local!.getTracks();
        window.call.end();
        return tracks.every(track => track.readyState === "ended");
      })).toBe(true);
      await expect.poll(() => b.evaluate(() => window.call.current)).toBeNull();
    } finally { await context.close(); }
  });
}
