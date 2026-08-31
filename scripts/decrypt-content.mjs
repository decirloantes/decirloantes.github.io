import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createDecipheriv } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptRoot, "..");
const encryptedPath = path.resolve(process.argv[2] ?? path.join(repositoryRoot, "automation", "content.enc"));
const outputRoot = path.resolve(process.argv[3] ?? path.join(repositoryRoot, ".private-content"));
const expectedOutputRoot = path.join(repositoryRoot, ".private-content");
const key = Buffer.from(process.env.CONTENT_KEY_B64 ?? "", "base64");

if (key.length !== 32) throw new Error("El secreto de publicación no tiene la longitud esperada.");
if (outputRoot !== expectedOutputRoot) throw new Error("El destino privado debe ser .private-content dentro del repositorio.");

const payload = await fs.readFile(encryptedPath);
if (payload.subarray(0, 4).toString("ascii") !== "DAB1") throw new Error("Formato cifrado no reconocido.");

const iv = payload.subarray(4, 16);
const tag = payload.subarray(16, 32);
const encrypted = payload.subarray(32);
const decipher = createDecipheriv("aes-256-gcm", key, iv);
decipher.setAuthTag(tag);
const manifest = JSON.parse(gunzipSync(Buffer.concat([decipher.update(encrypted), decipher.final()])).toString("utf8"));

if (manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error("Manifiesto cifrado no válido.");

await fs.rm(outputRoot, { recursive: true, force: true });
await fs.mkdir(outputRoot, { recursive: true });
for (const file of manifest.files) {
  if (typeof file.path !== "string" || file.path.startsWith("/") || file.path.includes("..") || file.path.includes("\\")) {
    throw new Error("El manifiesto contiene una ruta no segura.");
  }
  const destination = path.resolve(outputRoot, ...file.path.split("/"));
  if (!destination.startsWith(`${outputRoot}${path.sep}`)) throw new Error("Una ruta sale del destino privado.");
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, Buffer.from(file.content, "base64"));
}

console.log(JSON.stringify({ decrypted_files: manifest.files.length }));
