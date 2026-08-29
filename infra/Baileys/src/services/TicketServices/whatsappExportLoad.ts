import path from "path";
import fs from "fs";
import { promisify } from "util";
import extract from "extract-zip";
import { v4 as uuidv4 } from "uuid";
import AppError from "../../errors/AppError";
import { isMediaFileName } from "../../utils/whatsappExportParser";

const readFile = promisify(fs.readFile);
const readdir = promisify(fs.readdir);
const rmdir = promisify(fs.rm);

const publicFolder = path.resolve(__dirname, "..", "..", "..", "public");

const walkDir = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDir(full)));
    } else {
      files.push(full);
    }
  }
  return files;
};

const findTxtInDir = async (
  dir: string
): Promise<{ path: string; name: string }> => {
  const all = await walkDir(dir);
  const txts = all.filter(f => /\.txt$/i.test(f));
  if (!txts.length) {
    throw new AppError("ERR_WHATSAPP_IMPORT_NO_TXT", 400);
  }
  const sorted = txts.sort((a, b) => {
    const sa = fs.statSync(a).size;
    const sb = fs.statSync(b).size;
    return sb - sa;
  });
  return { path: sorted[0], name: path.basename(sorted[0]) };
};

export type LoadedWhatsAppExport = {
  rawText: string;
  txtFileName: string;
  mediaFiles: string[];
  tempDir: string | null;
};

export const loadExportFromFile = async (
  filePath: string,
  originalName: string
): Promise<LoadedWhatsAppExport> => {
  const ext = path.extname(originalName).toLowerCase();
  if (ext === ".txt") {
    const rawText = await readFile(filePath, "utf8");
    return { rawText, txtFileName: originalName, mediaFiles: [], tempDir: null };
  }

  if (ext !== ".zip") {
    throw new AppError("ERR_WHATSAPP_IMPORT_INVALID_FILE", 400);
  }

  const tempDir = path.join(publicFolder, "import-temp", uuidv4());
  fs.mkdirSync(tempDir, { recursive: true });
  await extract(filePath, { dir: tempDir });

  const { path: txtPath, name: txtFileName } = await findTxtInDir(tempDir);
  const rawText = await readFile(txtPath, "utf8");
  const allFiles = await walkDir(tempDir);
  const mediaFiles = allFiles
    .filter(f => isMediaFileName(f))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));

  return { rawText, txtFileName, mediaFiles, tempDir };
};

export const cleanupExportTempDir = async (tempDir: string | null): Promise<void> => {
  if (!tempDir || !fs.existsSync(tempDir)) return;
  try {
    await rmdir(tempDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
};
