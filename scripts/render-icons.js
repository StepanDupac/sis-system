import { chromium } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";

const svg = await readFile(new URL("../assets/mark.svg", import.meta.url), "utf8");
await mkdir(new URL("../extension/icons/", import.meta.url), { recursive: true });
const browser = await chromium.launch({ channel: "chromium" });
try {
  for (const size of [16, 32, 48, 128]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`);
    await page.screenshot({ path: `extension/icons/${size}.png`, omitBackground: true });
    await page.close();
  }
} finally { await browser.close(); }
console.log("Rendered four extension icons from the SVG source.");
