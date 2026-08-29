import multer from "multer";

// Configuração de multer para armazenar áudio em memória (não salva no disco)
export default multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      "audio/webm",
      "audio/mpeg",
      "audio/mp3",
      "audio/wav",
      "audio/m4a",
      "audio/ogg",
      "audio/opus",
      "audio/aac",
      "audio/flac"
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Tipo de arquivo inválido. Apenas áudios são permitidos."));
    }
  },
  limits: {
    fileSize: 25 * 1024 * 1024 // 25MB (limite para áudio)
  }
});
