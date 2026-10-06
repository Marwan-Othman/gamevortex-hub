const required = ["GEMINI_API_KEY", "GEMINI_IMAGE_MODEL", "GEMINI_VIDEO_MODEL"];
const missing = required.filter((key) => !process.env[key] || !String(process.env[key]).trim());
if (missing.length) {
  console.error("GameVortex AI provider check: missing " + missing.join(", "));
  process.exit(1);
}
if (Object.keys(process.env).some((key) => /^NEXT_PUBLIC_.*(KEY|SECRET|TOKEN|PASSWORD)/i.test(key))) {
  console.error("GameVortex AI provider check: secret-like NEXT_PUBLIC_ variable detected.");
  process.exit(1);
}
console.log("GameVortex AI provider check: PASS");
