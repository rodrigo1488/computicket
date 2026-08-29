import path from "path";
import multer from "multer";
import fs from "fs";

const publicFolder = path.resolve(__dirname, "..", "..", "public");
const productsFolder = path.resolve(publicFolder, "products");

export default {
  directory: productsFolder,
  storage: multer.diskStorage({
    destination: async function (_req, _file, cb) {
      if (!fs.existsSync(productsFolder)) {
        fs.mkdirSync(productsFolder, { recursive: true });
        fs.chmodSync(productsFolder, 0o777);
      }
      return cb(null, productsFolder);
    },
    filename(_req, file, cb) {
      const timestamp = new Date().getTime();
      const ext = path.extname(file.originalname) || ".jpg";
      const fileName = `${timestamp}_${Math.random().toString(36).substring(7)}${ext}`;
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
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Tipo de arquivo inválido. Apenas JPEG, PNG, GIF e WEBP são permitidos."));
    }
  },
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
};
