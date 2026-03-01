import { describe, expect, test } from "bun:test";
import {
  chunkMessage,
  DISCORD_MAX_LENGTH,
} from "../src/adapters/discord-native.js";

describe("chunkMessage", () => {
  test("returns single chunk for short text", () => {
    const text = "Hello, world!";
    const chunks = chunkMessage(text, 2000);
    expect(chunks).toEqual(["Hello, world!"]);
  });

  test("returns single chunk for text exactly at limit", () => {
    const text = "a".repeat(2000);
    const chunks = chunkMessage(text, 2000);
    expect(chunks).toEqual([text]);
  });

  test("splits at paragraph boundary", () => {
    const paragraph1 = "a".repeat(1000);
    const paragraph2 = "b".repeat(1500);
    const text = `${paragraph1}\n\n${paragraph2}`;
    const chunks = chunkMessage(text, 2000);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(paragraph1);
    expect(chunks[1]).toBe(paragraph2);
  });

  test("splits at line boundary when no paragraph", () => {
    const line1 = "a".repeat(1200);
    const line2 = "b".repeat(1200);
    const text = `${line1}\n${line2}`;
    const chunks = chunkMessage(text, 2000);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(line1);
    expect(chunks[1]).toBe(line2);
  });

  test("splits at space when no line break", () => {
    const word1 = "a".repeat(1200);
    const word2 = "b".repeat(1200);
    const text = `${word1} ${word2}`;
    const chunks = chunkMessage(text, 2000);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(word1);
    expect(chunks[1]).toBe(word2);
  });

  test("hard breaks when no natural boundaries", () => {
    const text = "a".repeat(5000);
    const chunks = chunkMessage(text, 2000);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toBe("a".repeat(2000));
    expect(chunks[1]).toBe("a".repeat(2000));
    expect(chunks[2]).toBe("a".repeat(1000));
  });

  test("handles multiple paragraph splits", () => {
    const p1 = "a".repeat(800);
    const p2 = "b".repeat(800);
    const p3 = "c".repeat(800);
    const p4 = "d".repeat(800);
    const text = `${p1}\n\n${p2}\n\n${p3}\n\n${p4}`;
    const chunks = chunkMessage(text, 2000);

    // Each pair should fit in one chunk (800 + 2 + 800 = 1602)
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(`${p1}\n\n${p2}`);
    expect(chunks[1]).toBe(`${p3}\n\n${p4}`);
  });

  test("prefers paragraph break over line break even if line break is later", () => {
    // Create text where paragraph break is at 1000 and line break at 1500
    const beforeParagraph = "a".repeat(1000);
    const afterParagraph = "b".repeat(400);
    const afterLine = "c".repeat(1000);
    const text = `${beforeParagraph}\n\n${afterParagraph}\n${afterLine}`;
    const chunks = chunkMessage(text, 2000);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(beforeParagraph);
    expect(chunks[1]).toBe(`${afterParagraph}\n${afterLine}`);
  });

  test("falls back to line when paragraph break is too early", () => {
    // Paragraph break at 200, line break at 1500
    const beforeParagraph = "a".repeat(200);
    const afterParagraph = "b".repeat(1300);
    const afterLine = "c".repeat(500);
    const text = `${beforeParagraph}\n\n${afterParagraph}\n${afterLine}`;
    const chunks = chunkMessage(text, 2000);

    expect(chunks).toHaveLength(2);
    // Should break at line (1500) not paragraph (200)
    expect(chunks[0]).toBe(`${beforeParagraph}\n\n${afterParagraph}`);
    expect(chunks[1]).toBe(afterLine);
  });

  test("handles empty string", () => {
    const chunks = chunkMessage("", 2000);
    expect(chunks).toEqual([""]);
  });

  test("trims whitespace from chunks", () => {
    const text = "hello   \n\n   world";
    const chunks = chunkMessage(text, 10);
    expect(chunks).toEqual(["hello", "world"]);
  });

  test("uses DISCORD_MAX_LENGTH constant correctly", () => {
    expect(DISCORD_MAX_LENGTH).toBe(2000);
  });
});
