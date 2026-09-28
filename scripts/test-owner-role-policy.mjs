import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const route = fs.readFileSync(path.join(root, "app/api/admin/owner-control/route.ts"), "utf8");
const ui = fs.readFileSync(path.join(root, "app/admin/users/UserRoleSelect.tsx"), "utf8");

const required = [
  "process.env.OWNER_EMAIL?.trim().toLowerCase()",
  "ONLY_CONFIGURED_OWNER_CAN_BE_SUPER_ADMIN",
  "OWNER_EMAIL_NOT_CONFIGURED",
  "OWNER_ROLE_CANNOT_BE_REMOVED",
];

const missing = required.filter((needle) => !route.includes(needle));
const uiRequired = [
  "canAssignOwnerRole = false",
  'initialRole === "SUPER_ADMIN"',
];
const missingUi = uiRequired.filter((needle) => !ui.includes(needle));

if (missing.length || missingUi.length) {
  console.error("Owner role policy check: FAIL");
  if (missing.length) console.error("Missing API safeguards:", missing.join(", "));
  if (missingUi.length) console.error("Missing UI safeguards:", missingUi.join(", "));
  process.exit(1);
}

console.log("Owner role policy check: PASS");
