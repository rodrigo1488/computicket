import path from "path";
import multer from "multer";
import fs from "fs";

const publicFolder = path.resolve(__dirname, "..", "..", "public");
const menuUploadFolder = path.resolve(publicFolder, "menu-import");

export default {
  directory: menuUploadFolder,
  storage: multer.diskStorage({
    destination: async function (_req, _file, cb) {
      if (!fs.existsSync(menuUploadFolder)) {
        fs.mkdirSync(menuUploadFolder, { recursive: true });
        fs.chmodSync(menuUploadFolder, 0o777);
      }
      return cb(null, menuUploadFolder);
    },
    filename(_req, file, cb) {
      const timestamp = new Date().getTime();
      const ext = path.extname(file.originalname) || ".pdf";
      const fileName = `menu_${timestamp}_${Math.random().toString(36).substring(7)}${ext}`;
      return cb(null, fileName);
    },
  }),
  fileFilter: (_req, file, cb) => {
    const allowedMimes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "image/webp",
      "application/pdf",
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Tipo de arquivo inválido. Use PDF, JPEG, PNG, GIF ou WEBP."
        )
      );
    }
  },
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB
  },
};
