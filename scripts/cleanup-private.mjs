import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptRoot, "..");
const privateRoot = path.join(repositoryRoot, ".private-content");

try {
  const resolved = await fs.realpath(privateRoot);
  if (resolved !== privateRoot) throw new Error("El destino privado resuelto no coincide con el esperado.");
  await fs.rm(privateRoot, { recursive: true, force: true });
  console.log(JSON.stringify({ removed_private_workspace: true }));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  console.log(JSON.stringify({ removed_private_workspace: false }));
}
