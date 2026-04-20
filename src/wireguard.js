import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const WG_EXE = "C:\\Program Files\\WireGuard\\wireguard.exe";
const WG_CLI = "C:\\Program Files\\WireGuard\\wg.exe";

/**
 * Cac thu muc WireGuard co the luu .conf file.
 * Bot thu lan luot cho den khi tim thay file.
 */
const WG_CONF_SEARCH_DIRS = [
  "C:\\Program Files\\WireGuard\\Data\\Configurations",
  "C:\\ProgramData\\WireGuard",
  "C:\\ProgramData\\WireGuard\\Configurations",
  "C:\\Windows\\System32\\config\\systemprofile\\AppData\\Local\\WireGuard",
  "C:\\Windows\\System32\\config\\systemprofile\\AppData\\Roaming\\WireGuard"
];

function buildVpnMessage(tunnelName, running) {
  return running
    ? `WireGuard (${tunnelName}): Dang ket noi (ON)`
    : `WireGuard (${tunnelName}): Da ngat ket noi (OFF)`;
}

/**
 * Tim duong dan den file .conf cua tunnel.
 * @param {string} tunnelName - Ten tunnel
 * @param {string} [overridePath] - Duong dan tuy chinh tu WG_CONF_PATH trong .env
 * @returns {string|null} - Duong dan file hoac null neu khong tim thay
 */
export function findConfPath(tunnelName, overridePath = "") {
  if (overridePath && fs.existsSync(overridePath)) {
    return overridePath;
  }

  for (const dir of WG_CONF_SEARCH_DIRS) {
    const candidate = path.join(dir, `${tunnelName}.conf`);
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // Bo qua loi quyen truy cap
    }
  }

  return null;
}

/**
 * Ket qua chan doan cho /vpndiag
 */
export function diagnoseConfPaths(tunnelName, overridePath = "") {
  const results = [];
  const candidates = overridePath
    ? [overridePath, ...WG_CONF_SEARCH_DIRS.map((dir) => path.join(dir, `${tunnelName}.conf`))]
    : WG_CONF_SEARCH_DIRS.map((dir) => path.join(dir, `${tunnelName}.conf`));

  for (const candidatePath of candidates) {
    let status;
    try {
      status = fs.existsSync(candidatePath) ? "[TIM THAY]" : "[KHONG CO]";
    } catch {
      status = "[KHONG CO QUYEN]";
    }
    results.push(`${status}: ${candidatePath}`);
  }

  return results;
}

async function exec(exePath, args = []) {
  try {
    const { stdout, stderr } = await execFileAsync(exePath, args, {
      timeout: 20000,
      windowsHide: true
    });
    return { ok: true, stdout: (stdout || "").trim(), stderr: (stderr || "").trim() };
  } catch (error) {
    return {
      ok: false,
      stdout: (error.stdout || "").trim(),
      stderr: (error.stderr || "").trim(),
      exitCode: error.status ?? error.exitCode ?? null,
      message: error.message || ""
    };
  }
}

/**
 * Lay trang thai VPN.
 * Thu nhieu phuong phap: wg.exe -> sc.exe -> PowerShell Get-NetAdapter.
 */
export async function getVpnStatus(tunnelName) {
  if (!tunnelName) {
    return { ok: false, running: false, message: "Chua cau hinh WG_TUNNEL_NAME." };
  }

  const wgResult = await exec(WG_CLI, ["show", "interfaces"]);
  if (wgResult.ok) {
    const ifaces = wgResult.stdout.split(/\s+/).map((item) => item.trim()).filter(Boolean);
    const running = ifaces.includes(tunnelName);
    return {
      ok: true,
      running,
      message: buildVpnMessage(tunnelName, running)
    };
  }

  const scResult = await exec("sc.exe", ["query", `WireGuardTunnel$${tunnelName}`]);
  if (scResult.stdout.includes("STATE") || scResult.stdout.includes("RUNNING")) {
    const running = scResult.stdout.includes("RUNNING");
    return {
      ok: true,
      running,
      message: buildVpnMessage(tunnelName, running)
    };
  }

  const psResult = await exec("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `try { $a = Get-NetAdapter -Name '${tunnelName}' -EA Stop; if ($a.Status -eq 'Up') { 'UP' } else { 'DOWN' } } catch { 'NOTFOUND' }`
  ]);
  if (psResult.ok) {
    const out = psResult.stdout.trim();
    if (out === "UP") {
      return { ok: true, running: true, message: buildVpnMessage(tunnelName, true) };
    }
    if (out === "DOWN") {
      return { ok: true, running: false, message: buildVpnMessage(tunnelName, false) };
    }
  }

  return {
    ok: false,
    running: false,
    message: `Khong xac dinh duoc trang thai VPN (${tunnelName}).`
  };
}

/**
 * Bat VPN.
 */
export async function connectVpn(tunnelName, overridePath = "") {
  if (!tunnelName) {
    return { ok: false, message: "Chua cau hinh WG_TUNNEL_NAME." };
  }

  const status = await getVpnStatus(tunnelName);
  if (status.running) {
    return { ok: true, message: `VPN da dang ket noi, khong can bat lai.\n${status.message}` };
  }

  const confPath = findConfPath(tunnelName, overridePath);
  if (!confPath) {
    const searched = WG_CONF_SEARCH_DIRS.map((dir) => path.join(dir, `${tunnelName}.conf`)).join("\n  - ");
    return {
      ok: false,
      message: [
        `Khong tim thay file config WireGuard cho "${tunnelName}".`,
        "",
        "Da tim trong:",
        `  - ${searched}`,
        "",
        "Giai phap: Them vao .env:",
        `WG_CONF_PATH=C:\\duong\\dan\\den\\${tunnelName}.conf`,
        "",
        "Dung lenh /vpndiag de kiem tra chi tiet."
      ].join("\n")
    };
  }

  const result = await exec(WG_EXE, ["/installtunnelservice", confPath]);
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const after = await getVpnStatus(tunnelName);

  if (after.running) {
    return { ok: true, message: `Da bat VPN thanh cong.\n${after.message}` };
  }

  const errDetail = [result.stderr, result.stdout].filter(Boolean).join(" | ") || result.message;
  return {
    ok: false,
    message: [
      `Khong the bat VPN "${tunnelName}".`,
      errDetail ? `Loi: ${errDetail}` : "",
      `File conf: ${confPath}`,
      "",
      "Goi y: Chay /vpndiag de kiem tra quyen truy cap."
    ].filter(Boolean).join("\n")
  };
}

/**
 * Tat VPN.
 */
export async function disconnectVpn(tunnelName) {
  if (!tunnelName) {
    return { ok: false, message: "Chua cau hinh WG_TUNNEL_NAME." };
  }

  const status = await getVpnStatus(tunnelName);
  if (status.ok && !status.running) {
    return { ok: true, message: `VPN da ngat ket noi, khong can tat lai.\n${status.message}` };
  }

  const result = await exec(WG_EXE, ["/uninstalltunnelservice", tunnelName]);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const after = await getVpnStatus(tunnelName);

  if (!after.running) {
    return { ok: true, message: `Da tat VPN thanh cong.\n${after.message}` };
  }

  const errDetail = [result.stderr, result.stdout].filter(Boolean).join(" | ") || result.message;
  return {
    ok: false,
    message: [
      `Khong the tat VPN "${tunnelName}".`,
      errDetail ? `Loi: ${errDetail}` : "",
      "Bot co the thieu quyen Administrator."
    ].filter(Boolean).join("\n")
  };
}
