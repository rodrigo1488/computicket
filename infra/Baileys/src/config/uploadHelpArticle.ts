import path from "path";
import multer from "multer";
import fs from "fs";

const publicFolder = path.resolve(__dirname, "..", "..", "public");
const helpArticleFolder = path.resolve(publicFolder, "help-articles");

export default {
  directory: helpArticleFolder,
  storage: multer.diskStorage({
    destination: async function (req, file, cb) {
      if (!fs.existsSync(helpArticleFolder)) {
        fs.mkdirSync(helpArticleFolder, { recursive: true });
        fs.chmodSync(helpArticleFolder, 0o777);
      }
      return cb(null, helpArticleFolder);
    },
    filename(req, file, cb) {
      const timestamp = new Date().getTime();
      const ext = path.extname(file.originalname);
      const fileName = `${timestamp}_${Math.random().toString(36).substring(7)}${ext}`;
      return cb(null, fileName);
    }
  }),
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "image/webp"
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only JPEG, PNG, GIF and WEBP are allowed."));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  }
};
