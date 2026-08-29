import path from "path";
import multer from "multer";
import fs from "fs";

const publicFolder = path.resolve(__dirname, "..", "..", "public");
const usersFolder = path.resolve(publicFolder, "users");

export default {
  directory: usersFolder,
  storage: multer.diskStorage({
    destination: async function (req, file, cb) {
      if (!fs.existsSync(usersFolder)) {
        fs.mkdirSync(usersFolder, { recursive: true });
        fs.chmodSync(usersFolder, 0o777);
      }
      return cb(null, usersFolder);
    },
    filename(req, file, cb) {
      const timestamp = new Date().getTime();
      const ext = path.extname(file.originalname);
      const fileName = `${timestamp}_${req.params.userId}${ext}`;
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
    fileSize: 5 * 1024 * 1024 // 5MB
  }
};
