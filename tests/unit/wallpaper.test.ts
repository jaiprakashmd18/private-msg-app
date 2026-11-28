import { afterEach, expect, it, vi } from "vitest";
import { prepareWallpaper } from "@/lib/media";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("resizes a decodable phone photo even when its MIME type is missing", async () => {
  const jpeg = new Blob(["photo"], { type: "image/jpeg" });
  const drawImage = vi.fn();
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage, fillRect: vi.fn() }),
    toBlob: (done: (blob: Blob) => void) => done(jpeg) };
  vi.stubGlobal("Image", class { naturalWidth = 3000; naturalHeight = 4000; async decode() {} });
  vi.stubGlobal("document", { createElement: () => canvas });
  expect(await prepareWallpaper(new File(["photo"], "photo"))).toBe(jpeg);
  expect([canvas.width, canvas.height]).toEqual([1200, 1600]);
});

it("explains how to recover when the browser cannot decode a photo", async () => {
  vi.stubGlobal("Image", class { async decode() { throw new Error("decode"); } });
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  await expect(prepareWallpaper(new File(["bad"], "image.heic"))).rejects.toThrow(/JPG, PNG or WebP copy/);
  expect(revoke).toHaveBeenCalledOnce();
});
