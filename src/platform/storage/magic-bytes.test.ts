import { describe, expect, it } from "vitest";
import {
  assertSupportedUploadContent,
  detectSupportedMimeType,
  extensionForMimeType,
  isSvgMimeType,
  looksLikeSvg,
  normalizeDeclaredMimeType,
  SUPPORTED_MIME_TYPES
} from "./magic-bytes";

function bytesOf(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from(Buffer.from(text, "utf8"));
}

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const WEBP = Uint8Array.from([...Buffer.from("RIFF"), 0x24, 0x00, 0x00, 0x00, ...Buffer.from("WEBPVP8 ")]);
const PDF = ascii("%PDF-1.7\n%");
const MP4 = Uint8Array.from([0x00, 0x00, 0x00, 0x18, ...Buffer.from("ftypisom")]);
const SVG = ascii('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>');
const HTML = ascii("<!doctype html><html><body>not an image</body></html>");

describe("detectSupportedMimeType", () => {
  it("detects PNG by signature", () => {
    expect(detectSupportedMimeType(PNG)).toBe("image/png");
  });

  it("detects JPEG by signature", () => {
    expect(detectSupportedMimeType(JPEG)).toBe("image/jpeg");
  });

  it("detects WebP by RIFF....WEBP", () => {
    expect(detectSupportedMimeType(WEBP)).toBe("image/webp");
  });

  it("detects PDF by %PDF header", () => {
    expect(detectSupportedMimeType(PDF)).toBe("application/pdf");
  });

  it("detects MP4 by ftyp box at offset 4", () => {
    expect(detectSupportedMimeType(MP4)).toBe("video/mp4");
  });

  it("returns null for empty payloads", () => {
    expect(detectSupportedMimeType(new Uint8Array(0))).toBeNull();
  });

  it("returns null for HTML, SVG and GIF payloads", () => {
    expect(detectSupportedMimeType(HTML)).toBeNull();
    expect(detectSupportedMimeType(SVG)).toBeNull();
    expect(detectSupportedMimeType(ascii("GIF89a"))).toBeNull();
  });

  it("does not treat a RIFF file without WEBP brand as WebP", () => {
    const riffWav = Uint8Array.from([...Buffer.from("RIFF"), 0x24, 0x00, 0x00, 0x00, ...Buffer.from("WAVEfmt ")]);
    expect(detectSupportedMimeType(riffWav)).toBeNull();
  });

  it("supports exactly the five allowed families", () => {
    expect(SUPPORTED_MIME_TYPES).toEqual([
      "image/png",
      "image/jpeg",
      "image/webp",
      "application/pdf",
      "video/mp4"
    ]);
  });
});

describe("assertSupportedUploadContent", () => {
  it("returns detected type and extension when the declared type matches", () => {
    expect(assertSupportedUploadContent(PNG, "image/png")).toEqual({
      contentType: "image/png",
      extension: ".png"
    });
    expect(assertSupportedUploadContent(JPEG, "image/jpeg").extension).toBe(".jpg");
    expect(assertSupportedUploadContent(WEBP, "image/webp").contentType).toBe("image/webp");
    expect(assertSupportedUploadContent(PDF, "application/pdf").contentType).toBe("application/pdf");
    expect(assertSupportedUploadContent(MP4, "video/mp4").contentType).toBe("video/mp4");
  });

  it("trusts magic bytes when the client declares nothing", () => {
    expect(assertSupportedUploadContent(PNG).contentType).toBe("image/png");
    expect(assertSupportedUploadContent(PNG, "").contentType).toBe("image/png");
    expect(assertSupportedUploadContent(PNG, "application/octet-stream").contentType).toBe("image/png");
  });

  it("normalizes client MIME aliases and parameters", () => {
    expect(assertSupportedUploadContent(JPEG, "image/jpg").contentType).toBe("image/jpeg");
    expect(assertSupportedUploadContent(PNG, "IMAGE/PNG; charset=binary").contentType).toBe("image/png");
  });

  it("rejects SVG no matter what is declared", () => {
    expect(() => assertSupportedUploadContent(SVG, "image/png")).toThrowError(/SVG/);
    expect(() => assertSupportedUploadContent(SVG, "image/svg+xml")).toThrowError(/SVG/);
    try {
      assertSupportedUploadContent(SVG, "image/svg+xml");
      expect.unreachable();
    } catch (error) {
      expect((error as { status?: number }).status).toBe(415);
      expect((error as { code?: string }).code).toBe("UNSUPPORTED_MEDIA_TYPE");
    }
  });

  it("rejects content that does not match the declared type (disguised HTML)", () => {
    expect(() => assertSupportedUploadContent(HTML, "image/png")).toThrowError(
      /无法识别上传文件的内容/
    );
    try {
      assertSupportedUploadContent(HTML, "image/png");
      expect.unreachable();
    } catch (error) {
      expect((error as { status?: number }).status).toBe(415);
      expect((error as { code?: string }).code).toBe("UNSUPPORTED_MEDIA_TYPE");
    }
  });

  it("rejects content whose magic bytes mismatch a declared supported type", () => {
    expect(() => assertSupportedUploadContent(PNG, "image/jpeg")).toThrowError(/不一致/);
    expect(() => assertSupportedUploadContent(JPEG, "video/mp4")).toThrowError(/不一致/);
  });

  it("rejects unsupported declared types", () => {
    expect(() => assertSupportedUploadContent(PNG, "image/gif")).toThrowError(/不支持的文件类型/);
    expect(() => assertSupportedUploadContent(HTML, "text/html")).toThrowError(
      /无法识别上传文件的内容/
    );
  });

  it("rejects empty payloads", () => {
    expect(() => assertSupportedUploadContent(new Uint8Array(0), "image/png")).toThrowError(
      /无法识别上传文件的内容/
    );
  });
});

describe("helpers", () => {
  it("maps MIME types to safe extensions", () => {
    expect(extensionForMimeType("image/png")).toBe(".png");
    expect(extensionForMimeType("image/jpeg")).toBe(".jpg");
    expect(extensionForMimeType("image/webp")).toBe(".webp");
    expect(extensionForMimeType("application/pdf")).toBe(".pdf");
    expect(extensionForMimeType("video/mp4")).toBe(".mp4");
  });

  it("detects SVG MIME types", () => {
    expect(isSvgMimeType("image/svg+xml")).toBe(true);
    expect(isSvgMimeType("IMAGE/SVG+XML; charset=utf-8")).toBe(true);
    expect(isSvgMimeType("image/png")).toBe(false);
    expect(isSvgMimeType(undefined)).toBe(false);
  });

  it("sniffs SVG documents without raising", () => {
    expect(looksLikeSvg(SVG)).toBe(true);
    expect(looksLikeSvg(ascii("<svg width='1'></svg>"))).toBe(true);
    expect(looksLikeSvg(PNG)).toBe(false);
    expect(looksLikeSvg(bytesOf())).toBe(false);
  });

  it("normalizes declared MIME types", () => {
    expect(normalizeDeclaredMimeType(" Image/PNG ; charset=binary")).toBe("image/png");
    expect(normalizeDeclaredMimeType("")).toBeNull();
    expect(normalizeDeclaredMimeType(null)).toBeNull();
    expect(normalizeDeclaredMimeType(undefined)).toBeNull();
  });
});
