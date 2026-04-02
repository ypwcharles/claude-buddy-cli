import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type ClaudeConfig = Record<string, unknown> & {
  userID?: string;
  oauthAccount?: {
    accountUuid?: string;
  } | null;
};

export type { ClaudeConfig };

export function getClaudeConfigPath(): string {
  const override = process.env.CLAUDE_BUDDY_CONFIG_PATH;
  if (override) {
    return override;
  }
  return path.join(os.homedir(), ".claude.json");
}

export async function loadClaudeConfig(): Promise<{
  path: string;
  data: ClaudeConfig;
}> {
  const filePath = getClaudeConfigPath();

  try {
    const raw = await readFile(filePath, "utf8");
    return {
      path: filePath,
      data: JSON.parse(raw) as ClaudeConfig,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        path: filePath,
        data: {},
      };
    }
    throw error;
  }
}

export async function applyUserIdToConfig(userID: string): Promise<{
  path: string;
  data: ClaudeConfig;
  warning?: string;
  backupPath?: string;
}> {
  const loaded = await loadClaudeConfig();
  const backupPath = await backupClaudeConfig(loaded.path);
  const nextData: ClaudeConfig = {
    ...loaded.data,
    userID,
  };

  const parent = path.dirname(loaded.path);
  await mkdir(parent, { recursive: true });
  await writeFile(loaded.path, `${JSON.stringify(nextData, null, 2)}\n`, "utf8");

  const accountUuid = nextData.oauthAccount?.accountUuid;
  const warning =
    typeof accountUuid === "string" && accountUuid.length > 0
      ? "Config contains oauthAccount.accountUuid, so Claude Code may ignore userID until that field is removed or inactive."
      : undefined;

  return {
    path: loaded.path,
    data: nextData,
    warning,
    backupPath,
  };
}

async function backupClaudeConfig(filePath: string): Promise<string | undefined> {
  let original: string;
  try {
    original = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${filePath}.bak.${timestamp}-${process.pid}`;
  await writeFile(backupPath, original, "utf8");
  return backupPath;
}

export async function inspectBuddyIdentityControl(): Promise<{
  path: string;
  config: ClaudeConfig;
  envTokenMode: boolean;
  envAccountMetadataMode: boolean;
  buddyIdSource: "oauthAccount.accountUuid" | "userID" | "anon";
  userIDControlsBuddy: boolean;
  compatibilityMode:
    | "env-token-userid-compatible"
    | "env-token-blocked-by-config-oauthAccount"
    | "env-token-blocked-by-env-account-metadata"
    | "standard-login-oauthAccount-active"
    | "userid-active"
    | "anon-fallback";
  recommendation: string;
}> {
  const loaded = await loadClaudeConfig();
  const configAccountUuid = loaded.data.oauthAccount?.accountUuid;
  const envTokenMode = Boolean(
    process.env.CLAUDE_CODE_OAUTH_TOKEN ||
      process.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR,
  );
  const envAccountMetadataMode = Boolean(
    process.env.CLAUDE_CODE_ACCOUNT_UUID &&
      process.env.CLAUDE_CODE_USER_EMAIL &&
      process.env.CLAUDE_CODE_ORGANIZATION_UUID,
  );

  let buddyIdSource: "oauthAccount.accountUuid" | "userID" | "anon" = "anon";
  if (typeof configAccountUuid === "string" && configAccountUuid.length > 0) {
    buddyIdSource = "oauthAccount.accountUuid";
  } else if (typeof loaded.data.userID === "string" && loaded.data.userID.length > 0) {
    buddyIdSource = "userID";
  }

  let compatibilityMode:
    | "env-token-userid-compatible"
    | "env-token-blocked-by-config-oauthAccount"
    | "env-token-blocked-by-env-account-metadata"
    | "standard-login-oauthAccount-active"
    | "userid-active"
    | "anon-fallback";
  let recommendation: string;

  if (envTokenMode && configAccountUuid) {
    compatibilityMode = "env-token-blocked-by-config-oauthAccount";
    recommendation =
      "CLAUDE_CODE_OAUTH_TOKEN is present, but ~/.claude.json still contains oauthAccount.accountUuid. Remove oauthAccount from config if you want userID to control /buddy.";
  } else if (envTokenMode && envAccountMetadataMode) {
    compatibilityMode = "env-token-blocked-by-env-account-metadata";
    recommendation =
      "CLAUDE_CODE_OAUTH_TOKEN is present, but CLAUDE_CODE_ACCOUNT_UUID / USER_EMAIL / ORGANIZATION_UUID are also set. Clear those env vars if you want userID to control /buddy.";
  } else if (envTokenMode && buddyIdSource === "userID") {
    compatibilityMode = "env-token-userid-compatible";
    recommendation =
      "Environment-token mode is active and no oauthAccount.accountUuid is stored, so userID currently controls /buddy.";
  } else if (buddyIdSource === "oauthAccount.accountUuid") {
    compatibilityMode = "standard-login-oauthAccount-active";
    recommendation =
      "oauthAccount.accountUuid currently controls /buddy. Changing userID alone will not change the pet.";
  } else if (buddyIdSource === "userID") {
    compatibilityMode = "userid-active";
    recommendation =
      "userID currently controls /buddy.";
  } else {
    compatibilityMode = "anon-fallback";
    recommendation =
      "Neither oauthAccount.accountUuid nor userID is present. /buddy would fall back to anon until userID is created or set.";
  }

  return {
    path: loaded.path,
    config: loaded.data,
    envTokenMode,
    envAccountMetadataMode,
    buddyIdSource,
    userIDControlsBuddy: buddyIdSource !== "oauthAccount.accountUuid",
    compatibilityMode,
    recommendation,
  };
}
