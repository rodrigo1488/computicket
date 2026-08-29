import { promisify } from "util";
import fs from "fs";
import { parseWhatsAppExport } from "../../utils/whatsappExportParser";
import {
  cleanupExportTempDir,
  loadExportFromFile
} from "./whatsappExportLoad";

const unlink = promisify(fs.unlink);

interface Request {
  filePath: string;
  originalName: string;
}

interface PreviewMessage {
  datetime: string;
  author: string | null;
  body: string;
  isMedia: boolean;
}

interface Response {
  participants: string[];
  systemLinesSkipped: number;
  mediaPlaceholderCount: number;
  chatTitleHint: string | null;
  zipMediaCount: number;
  messageCount: number;
  messages: PreviewMessage[];
}

const PreviewWhatsAppImportService = async ({
  filePath,
  originalName
}: Request): Promise<Response> => {
  let tempDir: string | null = null;

  try {
    const loaded = await loadExportFromFile(filePath, originalName);
    tempDir = loaded.tempDir;

    const parsed = parseWhatsAppExport(loaded.rawText, {
      fileName: originalName,
      txtFileName: loaded.txtFileName
    });

    const allMessages = parsed.messages.map(m => ({
      datetime: m.datetime.toISOString(),
      author: m.author,
      body: m.body,
      isMedia: m.isMedia
    }));

    let messages = allMessages;
    if (allMessages.length > 12) {
      messages = [...allMessages.slice(0, 6), ...allMessages.slice(-6)];
    }

    return {
      participants: parsed.participants,
      systemLinesSkipped: parsed.systemLinesSkipped,
      mediaPlaceholderCount: parsed.mediaPlaceholderCount,
      chatTitleHint: parsed.chatTitleHint,
      zipMediaCount: loaded.mediaFiles.length,
      messageCount: parsed.messages.length,
      messages
    };
  } finally {
    await cleanupExportTempDir(tempDir);
    if (filePath) {
      try {
        if (fs.existsSync(filePath)) {
          await unlink(filePath);
        }
      } catch {
        // ignore
      }
    }
  }
};

export default PreviewWhatsAppImportService;
