import type { OutputFile } from "../../core/types.js";
import type { IncomingMessage } from "./models.js";

export interface MessageChannel {
  send(text: string): Promise<void>;
  sendFiles(text: string, files: OutputFile[]): Promise<void>;
  markRead(): Promise<void>;
  startTyping(): Promise<void>;
  subscribe(): Promise<void>;
}

export interface IngressService {
  handleMessage(input: IncomingMessage, channel: MessageChannel): Promise<void>;
}
