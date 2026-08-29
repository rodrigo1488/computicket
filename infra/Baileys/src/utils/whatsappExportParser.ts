import { parse, isValid } from "date-fns";
import ptBR from "date-fns/locale/pt-BR";

const LINE_REGEX =
  /^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2})\s+-\s+(?:(.+?):\s*)?(.*)$/;

const MEDIA_PLACEHOLDERS = [
  "<mídia oculta>",
  "<midia oculta>",
  "<media omitted>",
  "‎<attached:"
];

const SYSTEM_PATTERNS = [
  /criptografia de ponta a ponta/i,
  /end-to-end encrypted/i,
  /está na sua lista de contatos/i,
  /is in your contacts/i,
  /as mensagens e ligações são protegidas/i,
  /messages and calls are end-to-end/i,
  /você criou o grupo/i,
  /you created group/i,
  /mudou o assunto/i,
  /changed the subject/i,
  /adicionou/i,
  /added/i,
  /saiu/i,
  /left/i,
  /removeu/i,
  /removed/i
];

export type ParticipantSide = "contact" | "me";

export type ParsedWhatsAppMessage = {
  datetime: Date;
  author: string | null;
  body: string;
  isMedia: boolean;
};

export type ParseWhatsAppExportResult = {
  messages: ParsedWhatsAppMessage[];
  participants: string[];
  systemLinesSkipped: number;
  mediaPlaceholderCount: number;
  chatTitleHint: string | null;
};

export const isMediaPlaceholder = (text: string): boolean => {
  if (!text || typeof text !== "string") return false;
  const lower = text.trim().toLowerCase();
  return MEDIA_PLACEHOLDERS.some(p => lower === p || lower.startsWith(p));
};

export const isSystemLine = (author: string | null, body: string): boolean => {
  const combined = `${author || ""} ${body || ""}`.trim();
  if (!combined) return true;
  if (!author && body) {
    return SYSTEM_PATTERNS.some(p => p.test(body));
  }
  return SYSTEM_PATTERNS.some(p => p.test(combined));
};

const parseDateTime = (datePart: string, timePart: string): Date | null => {
  const time = timePart.trim();
  const candidates = [
    "dd/MM/yyyy HH:mm",
    "d/M/yyyy HH:mm",
    "dd/MM/yy HH:mm",
    "M/d/yyyy HH:mm",
    "M/d/yy HH:mm"
  ];
  for (const fmt of candidates) {
    const d = parse(`${datePart} ${time}`, fmt, new Date(), { locale: ptBR });
    if (isValid(d)) return d;
  }
  return null;
};

export const extractChatTitleHint = (fileName?: string | null): string | null => {
  if (!fileName) return null;
  const base = fileName.replace(/\.(txt|zip)$/i, "");
  const m = base.match(/(?:conversa do whatsapp com|whatsapp chat with)\s+(.+)/i);
  return m ? m[1].trim() : null;
};

export const parseWhatsAppExport = (
  rawText: string,
  options: { fileName?: string; txtFileName?: string } = {}
): ParseWhatsAppExportResult => {
  const lines = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const messages: ParsedWhatsAppMessage[] = [];
  const participantsSet = new Set<string>();
  let systemLinesSkipped = 0;
  let mediaPlaceholderCount = 0;

  let current: {
    datetime: Date;
    author: string | null;
    bodyParts: string[];
  } | null = null;

  const flush = () => {
    if (!current) return;
    const body = (current.bodyParts || []).join("\n").trim();
    const author = current.author;
    if (isSystemLine(author, body)) {
      systemLinesSkipped += 1;
      current = null;
      return;
    }
    const isMedia = isMediaPlaceholder(body);
    if (isMedia) mediaPlaceholderCount += 1;
    if (author) participantsSet.add(author);
    messages.push({
      datetime: current.datetime,
      author: author || null,
      body: isMedia ? body : body || "",
      isMedia
    });
    current = null;
  };

  for (const line of lines) {
    const match = line.match(LINE_REGEX);
    if (match) {
      flush();
      const [, datePart, timePart, authorPart, bodyPart] = match;
      const datetime = parseDateTime(datePart, timePart);
      const author = authorPart ? authorPart.trim() : null;
      const body = (bodyPart || "").trim();
      current = {
        datetime: datetime || new Date(0),
        author,
        bodyParts: body ? [body] : []
      };
    } else if (current && line.trim()) {
      current.bodyParts.push(line);
    }
  }
  flush();

  const chatTitleHint =
    extractChatTitleHint(options.fileName) ||
    extractChatTitleHint(options.txtFileName);

  return {
    messages,
    participants: Array.from(participantsSet).sort(),
    systemLinesSkipped,
    mediaPlaceholderCount,
    chatTitleHint
  };
};

export const inferMediaTypeFromFilename = (filename: string): string => {
  const lower = filename.toLowerCase();
  if (/\.(jpe?g|png|gif|webp|bmp)$/i.test(lower)) return "image";
  if (/\.(mp4|mov|avi|mkv|webm)$/i.test(lower)) return "video";
  if (/\.(opus|ogg|mp3|m4a|aac|wav|ptt)/i.test(lower) || lower.includes("ptt-")) {
    return "audio";
  }
  if (/\.(webp)$/i.test(lower) && lower.includes("stk")) return "sticker";
  if (/stk-/.test(lower)) return "sticker";
  if (/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|txt|csv)$/i.test(lower)) {
    return "document";
  }
  return "document";
};

export const isMediaFileName = (name: string): boolean => {
  const base = name.split("/").pop() || name;
  if (/\.txt$/i.test(base)) return false;
  return /\.(jpe?g|png|gif|webp|bmp|mp4|mov|avi|mkv|webm|opus|ogg|mp3|m4a|aac|wav|pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar)$/i.test(
    base
  ) || /^(IMG-|VID-|AUD-|PTT-|STK-|DOC-)/i.test(base);
};
