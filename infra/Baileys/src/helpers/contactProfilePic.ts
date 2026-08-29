import fs from "fs";
import path from "path";
import uploadConfig from "../config/upload";

const fallbackProfilePicUrl = (): string =>
  `${process.env.FRONTEND_URL || ""}/nopicture.png`;

const localProfilePicPathFromUrl = (url: string): string | null => {
  const match = url.match(/\/public\/contacts\/(\d+)\/([^/?]+)\.jpg/);
  if (!match) {
    return null;
  }
  const companyId = match[1];
  const number = match[2];
  return path.join(
    uploadConfig.directory,
    "contacts",
    companyId,
    `${number}.jpg`
  );
};

export const isWhatsAppCdnProfileUrl = (url?: string | null): boolean =>
  !!url &&
  (url.includes("pps.whatsapp.net") ||
    url.includes("mmg.whatsapp.net") ||
    /whatsapp\.net\/v\//.test(url));

export const isLocalContactProfileUrl = (url?: string | null): boolean =>
  !!url && url.includes("/public/contacts/");

/** URLs do CDN do WhatsApp expiram — não devem ir para o frontend. */
export const sanitizeContactProfilePicUrl = (
  url?: string | null
): string => {
  if (!url || url.trim() === "") {
    return fallbackProfilePicUrl();
  }
  if (url.includes("nopicture")) {
    return url;
  }
  if (isWhatsAppCdnProfileUrl(url)) {
    return fallbackProfilePicUrl();
  }
  if (isLocalContactProfileUrl(url)) {
    const localPath = localProfilePicPathFromUrl(url);
    if (localPath && !fs.existsSync(localPath)) {
      return fallbackProfilePicUrl();
    }
  }
  return url;
};

export { fallbackProfilePicUrl };

export const sanitizeTicketContactPic = <T extends { contact?: { profilePicUrl?: string | null } }>(
  ticket: T
): T => {
  const plain: any =
    ticket && typeof (ticket as any).toJSON === "function"
      ? (ticket as any).toJSON()
      : ticket;

  if (!plain?.contact?.profilePicUrl) {
    return plain;
  }

  return {
    ...plain,
    contact: {
      ...plain.contact,
      profilePicUrl: sanitizeContactProfilePicUrl(plain.contact.profilePicUrl)
    }
  };
};
