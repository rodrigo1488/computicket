import path from "path";
import multer from "multer";
import fs from "fs";

const publicFolder = path.resolve(__dirname, "..", "..", "public");
const chatMediaFolder = path.resolve(publicFolder, "chat-media");

export default {
  directory: chatMediaFolder,
  storage: multer.diskStorage({
    destination: async function (req, file, cb) {
      if (!fs.existsSync(chatMediaFolder)) {
        fs.mkdirSync(chatMediaFolder, { recursive: true });
        fs.chmodSync(chatMediaFolder, 0o777);
      }
      return cb(null, chatMediaFolder);
    },
    filename(req, file, cb) {
      const timestamp = new Date().getTime();
      const ext = path.extname(file.originalname);
      const fileName = `${timestamp}_${req.params.id}${ext}`;
      return cb(null, fileName);
    }
  }),
  fileFilter: (_req, file, cb) => {
    const m = file.mimetype || "";
    const allowed =
      /^image\//.test(m) ||
      /^video\//.test(m) ||
      /^audio\//.test(m) ||
      /^text\//.test(m) ||
      /^font\//.test(m) ||
      /^application\//.test(m) ||
      m === "application/octet-stream";

    if (allowed) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Tipo de arquivo não permitido. Use imagens, vídeo, áudio, texto ou documentos (PDF, Office, etc.)."
        )
      );
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  }
};
