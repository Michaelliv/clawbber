#!/usr/bin/env bun

/**
 * WhatsApp Authentication Script
 *
 * Run this during setup to authenticate with WhatsApp.
 * Displays QR code, waits for scan, saves credentials, then exits.
 *
 * Usage:
 *   bearclaw auth whatsapp                             # QR code mode
 *   bearclaw auth whatsapp --pairing-code --phone 14155551234  # Pairing code mode
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestWaWebVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";

export interface WhatsAppAuthOptions {
  authDir: string;
  statusDir: string;
  usePairingCode?: boolean;
  phoneNumber?: string;
}

const STATUS_FILE_NAME = "whatsapp-status.txt";
const QR_FILE_NAME = "whatsapp-qr.txt";

// Silent logger for Baileys
const silentLogger = {
  level: "silent",
  child: () => silentLogger,
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
};

function askQuestion(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function writeStatus(statusDir: string, status: string): void {
  const statusPath = path.join(statusDir, STATUS_FILE_NAME);
  fs.writeFileSync(statusPath, status);
}

function writeQrData(statusDir: string, qr: string): void {
  const qrPath = path.join(statusDir, QR_FILE_NAME);
  fs.writeFileSync(qrPath, qr);
}

function clearQrData(statusDir: string): void {
  const qrPath = path.join(statusDir, QR_FILE_NAME);
  try {
    fs.unlinkSync(qrPath);
  } catch {
    // Ignore if file doesn't exist
  }
}

async function connectSocket(
  options: WhatsAppAuthOptions,
  isReconnect = false,
): Promise<void> {
  const { authDir, statusDir, usePairingCode, phoneNumber } = options;

  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  if (state.creds.registered && !isReconnect) {
    writeStatus(statusDir, "already_authenticated");
    console.log("✓ Already authenticated with WhatsApp");
    console.log(`  To re-authenticate, delete ${authDir} and run again.`);
    process.exit(0);
  }

  const { version } = await fetchLatestWaWebVersion({}).catch(() => {
    console.warn("Failed to fetch latest WA Web version, using default");
    return { version: undefined };
  });

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, silentLogger),
    },
    printQRInTerminal: false,
    logger: silentLogger,
    browser: Browsers.macOS("Chrome"),
  });

  if (usePairingCode && phoneNumber && !state.creds.me) {
    // Request pairing code after a short delay for connection to initialize
    // Only on first connect (not reconnect after 515)
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(phoneNumber);
        console.log(`\n🔗 Your pairing code: ${code}\n`);
        console.log("  1. Open WhatsApp on your phone");
        console.log("  2. Tap Settings → Linked Devices → Link a Device");
        console.log('  3. Tap "Link with phone number instead"');
        console.log(`  4. Enter this code: ${code}\n`);
        writeStatus(statusDir, `pairing_code:${code}`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("Failed to request pairing code:", message);
        writeStatus(statusDir, `failed:pairing_code_error`);
        process.exit(1);
      }
    }, 3000);
  }

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      // Write raw QR data to file so external tools can render it
      writeQrData(statusDir, qr);
      writeStatus(statusDir, "waiting_qr");
      console.log("Scan this QR code with WhatsApp:\n");
      console.log("  1. Open WhatsApp on your phone");
      console.log("  2. Tap Settings → Linked Devices → Link a Device");
      console.log("  3. Point your camera at the QR code below\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      const reason = (
        lastDisconnect?.error as { output?: { statusCode?: number } }
      )?.output?.statusCode;

      if (reason === DisconnectReason.loggedOut) {
        writeStatus(statusDir, "failed:logged_out");
        clearQrData(statusDir);
        console.log("\n✗ Logged out. Delete auth folder and try again.");
        process.exit(1);
      } else if (reason === DisconnectReason.timedOut) {
        writeStatus(statusDir, "failed:qr_timeout");
        clearQrData(statusDir);
        console.log("\n✗ QR code timed out. Please try again.");
        process.exit(1);
      } else if (reason === 515) {
        // 515 = stream error, often happens after pairing succeeds but before
        // registration completes. Reconnect to finish the handshake.
        console.log("\n⟳ Stream error (515) after pairing — reconnecting...");
        connectSocket(options, true);
      } else {
        writeStatus(statusDir, `failed:${reason || "unknown"}`);
        clearQrData(statusDir);
        console.log("\n✗ Connection failed. Please try again.");
        process.exit(1);
      }
    }

    if (connection === "open") {
      writeStatus(statusDir, "authenticated");
      clearQrData(statusDir);
      console.log("\n✓ Successfully authenticated with WhatsApp!");
      console.log(`  Credentials saved to ${authDir}/`);
      console.log("  You can now start bearclaw with 'bearclaw run'.\n");

      // Give it a moment to save credentials, then exit
      setTimeout(() => process.exit(0), 1000);
    }
  });

  sock.ev.on("creds.update", saveCreds);
}

export async function authenticate(
  options: WhatsAppAuthOptions,
): Promise<void> {
  const { authDir, statusDir, usePairingCode } = options;
  let { phoneNumber } = options;

  // Ensure directories exist
  fs.mkdirSync(authDir, { recursive: true });
  fs.mkdirSync(statusDir, { recursive: true });

  // Clean up any stale QR/status files from previous runs
  clearQrData(statusDir);
  try {
    fs.unlinkSync(path.join(statusDir, STATUS_FILE_NAME));
  } catch {
    // Ignore
  }

  if (usePairingCode && !phoneNumber) {
    phoneNumber = await askQuestion(
      "Enter your phone number (with country code, no + or spaces, e.g. 14155551234): ",
    );
  }

  console.log("Starting WhatsApp authentication...\n");

  await connectSocket({ ...options, phoneNumber });
}

// CLI entry point when run directly
if (import.meta.main) {
  const args = process.argv.slice(2);
  const usePairingCode = args.includes("--pairing-code");
  const phoneIndex = args.findIndex((_, i, arr) => arr[i - 1] === "--phone");
  const phoneNumber = phoneIndex >= 0 ? args[phoneIndex] : undefined;
  const authDirIndex = args.findIndex(
    (_, i, arr) => arr[i - 1] === "--auth-dir",
  );
  const statusDirIndex = args.findIndex(
    (_, i, arr) => arr[i - 1] === "--status-dir",
  );

  const dataDir = process.env.BEARCLAW_DATA_DIR || ".bearclaw";
  const authDir =
    authDirIndex >= 0
      ? args[authDirIndex]
      : process.env.BEARCLAW_WHATSAPP_AUTH_DIR ||
        path.join(dataDir, "whatsapp-auth");
  const statusDir = statusDirIndex >= 0 ? args[statusDirIndex] : dataDir;

  authenticate({
    authDir,
    statusDir,
    usePairingCode,
    phoneNumber,
  }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Authentication failed:", message);
    process.exit(1);
  });
}
