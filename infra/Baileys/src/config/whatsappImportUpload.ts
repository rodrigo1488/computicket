import path from "path";
import fs from "fs";
import multer from "multer";

export const WHATSAPP_IMPORT_MAX_BYTES = 150 * 1024 * 1024;

const uploadDir = path.resolve(
  __dirname,
  "..",
  "..",
  "public",
  "import-uploads"
);

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}_${safe}`);
  }
});

export const whatsappImportUpload = multer({
  storage,
  limits: { fileSize: WHATSAPP_IMPORT_MAX_BYTES }
});

/** Remove ficheiros antigos da pasta de upload temporário (não remove mídias já ligadas às mensagens). */
export const purgeStaleImportUploads = (maxAgeMs = 60 * 60 * 1000): void => {
  try {
    const now = Date.now();
    for (const name of fs.readdirSync(uploadDir)) {
      const full = path.join(uploadDir, name);
      const stat = fs.statSync(full);
      if (stat.isFile() && now - stat.mtimeMs > maxAgeMs) {
        fs.unlinkSync(full);
      }
    }
  } catch {
    // ignore
  }
};

export { uploadDir as whatsappImportUploadDir };
