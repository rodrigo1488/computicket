export type ParsedVCardPhone = {
  number: string;
  digits: string;
  label?: string;
  waid?: string;
};

export type ParsedVCard = {
  name: string;
  phones: ParsedVCardPhone[];
  photoDataUrl?: string | null;
};

function unfoldVCard(raw: string) {
  return raw.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function formatPhoneDisplay(raw: string, digits: string) {
  const trimmed = raw.trim();
  if (trimmed && /[+\d]/.test(trimmed) && trimmed.length < 40) return trimmed;
  if (digits.length >= 12 && digits.startsWith("55")) {
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4);
    if (rest.length === 9) return `+55 ${ddd} ${rest.slice(0, 5)}-${rest.slice(5)}`;
    if (rest.length === 8) return `+55 ${ddd} ${rest.slice(0, 4)}-${rest.slice(4)}`;
  }
  return trimmed || digits;
}

/** Extrai propriedades TEL / FN / PHOTO de um bloco VCARD. */
export function parseVCard(raw?: string | null): ParsedVCard | null {
  if (!raw || !/BEGIN:VCARD/i.test(raw)) return null;
  const text = unfoldVCard(raw);
  const blocks = text.split(/BEGIN:VCARD/i).slice(1);
  const block = blocks[0];
  if (!block) return null;

  let name = "";
  const phones: ParsedVCardPhone[] = [];
  let photoDataUrl: string | null = null;

  const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (/^END:VCARD/i.test(line) || /^VERSION:/i.test(line)) continue;

    const fn = line.match(/^FN[;:](.*)$/i);
    if (fn) {
      name = fn[1].replace(/^:/, "").trim() || name;
      continue;
    }

    const n = line.match(/^N[;:](.*)$/i);
    if (n && !name) {
      const parts = n[1].replace(/^:/, "").split(";").map((p) => p.trim()).filter(Boolean);
      name = parts.slice(0, 2).reverse().join(" ").trim() || name;
      continue;
    }

    const tel = line.match(/^(?:item\d+\.)?TEL([^:]*):(.*)$/i);
    if (tel) {
      const params = tel[1] || "";
      const value = (tel[2] || "").trim();
      const waid = params.match(/waid=([^;:]+)/i)?.[1]?.replace(/\D/g, "");
      const digits = digitsOnly(waid || value);
      if (digits.length >= 8) {
        phones.push({
          number: formatPhoneDisplay(value, digits),
          digits,
          waid: waid || undefined,
        });
      }
      continue;
    }

    const label = line.match(/^(?:item\d+\.)?X-ABLabel:(.*)$/i);
    if (label && phones.length) {
      const last = phones[phones.length - 1];
      if (last && !last.label) last.label = label[1].trim();
      continue;
    }

    const photo = line.match(/^PHOTO([^:]*):(.*)$/i);
    if (photo && !photoDataUrl) {
      const params = (photo[1] || "").toUpperCase();
      const data = (photo[2] || "").replace(/\s+/g, "");
      if (!data || data.length > 400_000) continue;
      const isBase64 = /BASE64|ENCODING=B/.test(params) || /^\/9j\/|^iVBOR|^R0lGOD/.test(data);
      if (!isBase64) continue;
      let mime = "image/jpeg";
      if (/TYPE=PNG/i.test(params) || data.startsWith("iVBOR")) mime = "image/png";
      else if (/TYPE=GIF/i.test(params) || data.startsWith("R0lGOD")) mime = "image/gif";
      else if (/TYPE=WEBP/i.test(params)) mime = "image/webp";
      photoDataUrl = `data:${mime};base64,${data}`;
    }
  }

  if (!name && !phones.length) return null;
  if (!name && phones[0]) name = phones[0].number;

  // dedupe phones by digits
  const seen = new Set<string>();
  const uniquePhones = phones.filter((p) => {
    if (seen.has(p.digits)) return false;
    seen.add(p.digits);
    return true;
  });

  return { name, phones: uniquePhones, photoDataUrl };
}

export function isVCardBody(text?: string | null) {
  return !!text && /BEGIN:VCARD/i.test(text);
}

export function isContactShareMessage(mediaType?: string | null, body?: string | null) {
  const t = (mediaType || "").toLowerCase();
  if (t === "contactmessage" || t === "contactsarraymessage" || t === "vcard") return true;
  return isVCardBody(body);
}

export function vcardSnippet(text?: string | null) {
  if (!text) return null;
  if (/^varios contatos$/i.test(text.trim())) return "Vários contatos";
  const parsed = parseVCard(text);
  if (!parsed) return isVCardBody(text) ? "Contato compartilhado" : null;
  const phone = parsed.phones[0]?.number;
  return phone ? `Contato: ${parsed.name} · ${phone}` : `Contato: ${parsed.name}`;
}
