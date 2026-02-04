import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..", "..")
const src = path.join(repoRoot, "docs", "openapi.yaml")
const destDir = path.join(repoRoot, "ui", "public")
const dest = path.join(destDir, "openapi.yaml")

const data = await fs.readFile(src, "utf8")
await fs.mkdir(destDir, { recursive: true })
await fs.writeFile(dest, data, "utf8")
