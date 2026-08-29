import multer from "multer";

// Upload em memória para documento de despesa (foto/scan)
export default multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    const allowedMimes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
      "image/gif",
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Tipo de arquivo inválido. Envie uma imagem (JPEG, PNG, WEBP ou GIF)."));
    }
  },
  limits: {
    fileSize: 12 * 1024 * 1024, // 12MB
  },
});

