import { describe, expect, test } from "bun:test";
import type { proto } from "@whiskeysockets/baileys";
import { detectWhatsAppMedia } from "../src/adapters/whatsapp-media.js";

describe("detectWhatsAppMedia", () => {
  test("returns null for empty message", () => {
    expect(detectWhatsAppMedia(null)).toBeNull();
    expect(detectWhatsAppMedia(undefined)).toBeNull();
  });

  test("returns null for text-only message", () => {
    const message: proto.IMessage = {
      conversation: "Hello world",
    };
    expect(detectWhatsAppMedia(message)).toBeNull();
  });

  test("detects image message", () => {
    const message: proto.IMessage = {
      imageMessage: {
        mimetype: "image/jpeg",
        fileLength: 12345 as unknown as Long,
      },
    };
    const result = detectWhatsAppMedia(message);
    expect(result).not.toBeNull();
    expect(result?.type).toBe("image");
    expect(result?.mimeType).toBe("image/jpeg");
    expect(result?.fileLength).toBe(12345);
  });

  test("detects video message", () => {
    const message: proto.IMessage = {
      videoMessage: {
        mimetype: "video/mp4",
        fileLength: 54321 as unknown as Long,
      },
    };
    const result = detectWhatsAppMedia(message);
    expect(result).not.toBeNull();
    expect(result?.type).toBe("video");
    expect(result?.mimeType).toBe("video/mp4");
    expect(result?.fileLength).toBe(54321);
  });

  test("detects voice note (ptt=true)", () => {
    const message: proto.IMessage = {
      audioMessage: {
        mimetype: "audio/ogg",
        ptt: true,
        fileLength: 9999 as unknown as Long,
      },
    };
    const result = detectWhatsAppMedia(message);
    expect(result).not.toBeNull();
    expect(result?.type).toBe("voice");
    expect(result?.mimeType).toBe("audio/ogg");
  });

  test("detects regular audio (ptt=false)", () => {
    const message: proto.IMessage = {
      audioMessage: {
        mimetype: "audio/mpeg",
        ptt: false,
        fileLength: 8888 as unknown as Long,
      },
    };
    const result = detectWhatsAppMedia(message);
    expect(result).not.toBeNull();
    expect(result?.type).toBe("audio");
    expect(result?.mimeType).toBe("audio/mpeg");
  });

  test("detects document message", () => {
    const message: proto.IMessage = {
      documentMessage: {
        mimetype: "application/pdf",
        fileName: "report.pdf",
        fileLength: 77777 as unknown as Long,
      },
    };
    const result = detectWhatsAppMedia(message);
    expect(result).not.toBeNull();
    expect(result?.type).toBe("document");
    expect(result?.mimeType).toBe("application/pdf");
    expect(result?.filename).toBe("report.pdf");
  });

  test("detects sticker as image", () => {
    const message: proto.IMessage = {
      stickerMessage: {
        mimetype: "image/webp",
        fileLength: 5000 as unknown as Long,
      },
    };
    const result = detectWhatsAppMedia(message);
    expect(result).not.toBeNull();
    expect(result?.type).toBe("image");
    expect(result?.mimeType).toBe("image/webp");
  });

  test("uses default mimeType when not specified", () => {
    const imageMsg: proto.IMessage = { imageMessage: {} };
    expect(detectWhatsAppMedia(imageMsg)?.mimeType).toBe("image/jpeg");

    const videoMsg: proto.IMessage = { videoMessage: {} };
    expect(detectWhatsAppMedia(videoMsg)?.mimeType).toBe("video/mp4");

    const audioMsg: proto.IMessage = { audioMessage: {} };
    expect(detectWhatsAppMedia(audioMsg)?.mimeType).toBe("audio/mpeg");

    const voiceMsg: proto.IMessage = { audioMessage: { ptt: true } };
    expect(detectWhatsAppMedia(voiceMsg)?.mimeType).toBe("audio/ogg");

    const docMsg: proto.IMessage = { documentMessage: {} };
    expect(detectWhatsAppMedia(docMsg)?.mimeType).toBe(
      "application/octet-stream",
    );
  });
});
