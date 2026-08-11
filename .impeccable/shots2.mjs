import puppeteer from "puppeteer-core";
import fs from "node:fs";

const jar = fs.readFileSync(new URL("./ui.txt", import.meta.url), "utf8");
const line = jar.split("\n").find((l) => l.includes("better-auth.session_token"));
const value = line.split("\t").pop().trim();
const token = fs.readFileSync(new URL("./token.txt", import.meta.url), "utf8").trim();

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/chromium-browser",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"],
});

const shots = [
  { name: "r2-landing-desktop", url: "http://localhost:3000/", w: 1440, h: 1100 },
  { name: "r2-landing-mobile", url: "http://localhost:3000/", w: 390, h: 844, full: true },
  { name: "r2-dashboard-desktop", url: "http://localhost:3000/dashboard", w: 1440, h: 1200, auth: true, full: true },
  { name: "r2-dashboard-mobile", url: "http://localhost:3000/dashboard", w: 390, h: 900, auth: true, full: true },
  { name: "r2-share-desktop", url: `http://localhost:3000/s/${token}`, w: 1440, h: 900 },
  { name: "r2-share-mobile", url: `http://localhost:3000/s/${token}`, w: 390, h: 844 },
  { name: "r2-login", url: "http://localhost:3000/login", w: 1440, h: 900 },
];

for (const shot of shots) {
  const page = await browser.newPage();
  await page.setViewport({ width: shot.w, height: shot.h, deviceScaleFactor: 2 });
  if (shot.auth) {
    await page.setCookie({ name: "better-auth.session_token", value, domain: "localhost", path: "/" });
  }
  await page.goto(shot.url, { waitUntil: "networkidle0", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1000));
  await page.screenshot({ path: `shots/${shot.name}.png`, fullPage: !!shot.full });
  console.log("captured", shot.name);
  await page.close();
}
await browser.close();
