import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptRoot, "..");
const sourceRoot = path.resolve(process.argv[2] ?? path.join(repositoryRoot, ".private-content", "site"));
const destinationRoot = path.resolve(process.argv[3] ?? repositoryRoot);
const files = [".nojekyll", "404.html", "feed.xml", "index.html", "robots.txt", "sitemap.xml"];
const directories = ["acerca-de", "archivo", "assets", "posts"];

await fs.access(path.join(destinationRoot, ".git"));
await fs.access(path.join(sourceRoot, "index.html"));

for (const name of [...files, ...directories]) {
  const destination = path.join(destinationRoot, name);
  await fs.rm(destination, { recursive: true, force: true });
  const source = path.join(sourceRoot, name);
  try {
    const stat = await fs.stat(source);
    if (stat.isDirectory()) await fs.cp(source, destination, { recursive: true });
    else await fs.copyFile(source, destination);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

console.log(JSON.stringify({ synced_files: files, synced_directories: directories }));
