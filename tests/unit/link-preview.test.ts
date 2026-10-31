import http from "node:http";
import { describe, expect, it } from "vitest";
import { findLinks, isBlockedAddress, parsePreview } from "@/lib/link-preview";
import { safeFetch } from "@/lib/safe-fetch.server";

describe("links in messages", () => {
  it("finds http(s) links and leaves sentence punctuation out", () => {
    expect(findLinks("See https://maps.app.goo.gl/abc. And http://example.com/a_(b) ok, javascript:alert(1)").map((l) => l.url)).toEqual([
      "https://maps.app.goo.gl/abc",
      "http://example.com/a_(b)",
    ]);
    expect(findLinks("no links here")).toEqual([]);
  });
});

describe("link preview parsing", () => {
  it("reads Open Graph tags, falls back to <title>, resolves relative images", () => {
    const html = `<html><head><title>Fallback</title>
      <meta property="og:title" content="Goa Beach Resort &amp; Spa">
      <meta name='description' content='Sun, sand &#38; sea'>
      <meta property="og:image" content="/img/cover.jpg">
      <meta property="og:site_name" content="Resorts">
      </head></html>`;
    expect(parsePreview(html, "https://resorts.example/goa")).toEqual({
      url: "https://resorts.example/goa",
      title: "Goa Beach Resort & Spa",
      description: "Sun, sand & sea",
      siteName: "Resorts",
      image: "https://resorts.example/img/cover.jpg",
    });
    expect(parsePreview("<title>Only title</title>", "https://www.x.example/p")).toMatchObject({ title: "Only title", siteName: "x.example", image: null });
    expect(parsePreview("<p>nothing</p>", "https://x.example")).toBeNull();
    expect(parsePreview(`<meta property="og:title" content="T"><meta property="og:image" content="javascript:alert(1)">`, "https://x.example")?.image).toBeNull();
  });
});

describe("server-side fetching can't reach private networks", () => {
  it("blocks private, local and metadata addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "224.0.0.1"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "142.250.72.14", "2606:4700:4700::1111"]) expect(isBlockedAddress(ip), ip).toBe(false);
  });

  it("refuses to connect to this machine, by IP or by name", async () => {
    let hits = 0;
    const server = http.createServer((_req, res) => {
      hits += 1;
      res.end("<title>secret</title>");
    });
    await new Promise<void>((r) => server.listen(8080, "127.0.0.1", r));
    try {
      for (const url of ["http://127.0.0.1:8080/", "http://localhost:8080/", "http://[::ffff:127.0.0.1]:8080/", "http://127.1:8080/"]) {
        await expect(safeFetch(url, { maxBytes: 1000, accept: "text/html" }), url).rejects.toThrow();
      }
      await expect(safeFetch("file:///etc/passwd", { maxBytes: 1000, accept: "*/*" })).rejects.toThrow(/Only web links/);
      await expect(safeFetch("http://user:pw@example.com/", { maxBytes: 1000, accept: "*/*" })).rejects.toThrow(/credentials/);
      expect(hits).toBe(0);
    } finally {
      server.close();
    }
  });
});
