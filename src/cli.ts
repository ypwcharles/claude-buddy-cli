import { searchSeeds, type SearchProgressEvent } from "./search/search.js";
import type { SearchFilters } from "./search/filters.js";
import { applyUserIdToConfig, inspectBuddyIdentityControl } from "./claude/config.js";
import { resolveRuntime } from "./claude/runtime.js";
import { reconstructUidForSeed } from "./uid/reconstruct.js";

export type CliSurface = {
  name: string;
  description: string;
  helpText: string;
};

export type CliIo = {
  write?: (chunk: string) => void;
  writeStdout?: (chunk: string) => void;
  writeStderr?: (chunk: string) => void;
  stderrIsTTY?: boolean;
};

type RuntimeMode = "auto" | "node" | "bun";

type FindCommandOptions = {
  runtime: RuntimeMode;
  json: boolean;
  apply: boolean;
  forceApply: boolean;
  startSeed?: number;
  endSeed?: number;
  limit?: number;
  filters: SearchFilters;
};

const HELP_TEXT = `claude-buddy

Claude Code Buddy 搜索与应用 CLI
Claude Code Buddy search and apply CLI.

AI AGENT CONTRACT / AI AGENT 调用约定
  - 默认行为: 只输出候选结果，不修改配置。
  - No config mutation happens unless --apply is present.
  - 运行时默认 auto，可用 --runtime node|bun|auto 覆盖。
  - Runtime defaults to auto and may be overridden with --runtime node|bun|auto.
  - 建议 agent 使用 --json 解析 stdout。
  - Prefer --json when another agent or script will parse stdout.
  - 长时间全量扫描时，进度会输出到 stderr，不污染 JSON。
  - Exhaustive scans emit compact progress on stderr and keep stdout machine-readable.

COMMAND / 命令
  claude-buddy find [flags]
  claude-buddy doctor [--json]

FIND FLAGS / 查询参数
  --species <name>          按物种筛选 / Filter by species
  --rarity <name>           按稀有度筛选 / Filter by rarity
  --eye <glyph>             按眼睛样式筛选 / Filter by eye glyph
  --hat <name>              按帽子筛选 / Filter by hat
  --shiny <true|false>      按闪光状态筛选 / Filter by shiny state
  --min-total <n>           最低总属性 / Minimum total stats
  --max-total <n>           最高总属性 / Maximum total stats
  --debugging <n>           DEBUGGING 精确值 / Exact DEBUGGING stat
  --min-debugging <n>       DEBUGGING 最小值 / Minimum DEBUGGING stat
  --max-debugging <n>       DEBUGGING 最大值 / Maximum DEBUGGING stat
  --patience <n>            PATIENCE 精确值 / Exact PATIENCE stat
  --min-patience <n>        PATIENCE 最小值 / Minimum PATIENCE stat
  --max-patience <n>        PATIENCE 最大值 / Maximum PATIENCE stat
  --chaos <n>               CHAOS 精确值 / Exact CHAOS stat
  --min-chaos <n>           CHAOS 最小值 / Minimum CHAOS stat
  --max-chaos <n>           CHAOS 最大值 / Maximum CHAOS stat
  --wisdom <n>              WISDOM 精确值 / Exact WISDOM stat
  --min-wisdom <n>          WISDOM 最小值 / Minimum WISDOM stat
  --max-wisdom <n>          WISDOM 最大值 / Maximum WISDOM stat
  --snark <n>               SNARK 精确值 / Exact SNARK stat
  --min-snark <n>           SNARK 最小值 / Minimum SNARK stat
  --max-snark <n>           SNARK 最大值 / Maximum SNARK stat
  --start-seed <n>          起始 seed，含本值 / Inclusive seed scan start
  --end-seed <n>            结束 seed，不含本值 / Exclusive seed scan end
  --limit <n>               返回结果上限 / Maximum result count
  --runtime <mode>          auto | node | bun
  --json                    stdout 输出 JSON / Print machine-readable JSON to stdout
  --apply                   将选中的 uid 写入 ~/.claude.json / Write selected uid
  --force-apply             即使 userID 不生效也强制写入 / Force write userID
  --help                    打印帮助 / Print this help

EXAMPLES / 示例
  claude-buddy find --species dragon --shiny true --min-total 400 --json
  claude-buddy find --species duck --rarity common --limit 5
  claude-buddy doctor --json
`;

export function buildCli(): CliSurface {
  return {
    name: "claude-buddy",
    description: "Claude Code Buddy search and apply CLI.",
    helpText: HELP_TEXT,
  };
}

function parseBoolean(value: string): boolean {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`Invalid boolean value: ${value}`);
}

function parseNumberFlag(flag: string, value: string | undefined): number {
  if (value === undefined) {
    throw new Error(`Missing value for ${flag}`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number for ${flag}: ${value}`);
  }
  return parsed;
}

function parseRuntime(value: string | undefined): RuntimeMode {
  if (value === undefined || value === "auto") {
    return "auto";
  }
  if (value === "node" || value === "bun") {
    return value;
  }
  throw new Error(`Invalid runtime: ${value}`);
}

function parseFindArgs(argv: string[]): FindCommandOptions {
  const filters: SearchFilters = {};
  let runtime: RuntimeMode = "auto";
  let json = false;
  let apply = false;
  let forceApply = false;
  let startSeed: number | undefined;
  let endSeed: number | undefined;
  let limit: number | undefined;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case "--species":
        filters.species = next as SearchFilters["species"];
        index++;
        break;
      case "--rarity":
        filters.rarity = next as SearchFilters["rarity"];
        index++;
        break;
      case "--eye":
        filters.eye = next as SearchFilters["eye"];
        index++;
        break;
      case "--hat":
        filters.hat = next as SearchFilters["hat"];
        index++;
        break;
      case "--shiny":
        filters.shiny = parseBoolean(next ?? "");
        index++;
        break;
      case "--min-total":
        filters.minTotal = parseNumberFlag(arg, next);
        index++;
        break;
      case "--max-total":
        filters.maxTotal = parseNumberFlag(arg, next);
        index++;
        break;
      case "--debugging":
        filters.debugging = parseNumberFlag(arg, next);
        index++;
        break;
      case "--min-debugging":
        filters.minDebugging = parseNumberFlag(arg, next);
        index++;
        break;
      case "--max-debugging":
        filters.maxDebugging = parseNumberFlag(arg, next);
        index++;
        break;
      case "--patience":
        filters.patience = parseNumberFlag(arg, next);
        index++;
        break;
      case "--min-patience":
        filters.minPatience = parseNumberFlag(arg, next);
        index++;
        break;
      case "--max-patience":
        filters.maxPatience = parseNumberFlag(arg, next);
        index++;
        break;
      case "--chaos":
        filters.chaos = parseNumberFlag(arg, next);
        index++;
        break;
      case "--min-chaos":
        filters.minChaos = parseNumberFlag(arg, next);
        index++;
        break;
      case "--max-chaos":
        filters.maxChaos = parseNumberFlag(arg, next);
        index++;
        break;
      case "--wisdom":
        filters.wisdom = parseNumberFlag(arg, next);
        index++;
        break;
      case "--min-wisdom":
        filters.minWisdom = parseNumberFlag(arg, next);
        index++;
        break;
      case "--max-wisdom":
        filters.maxWisdom = parseNumberFlag(arg, next);
        index++;
        break;
      case "--snark":
        filters.snark = parseNumberFlag(arg, next);
        index++;
        break;
      case "--min-snark":
        filters.minSnark = parseNumberFlag(arg, next);
        index++;
        break;
      case "--max-snark":
        filters.maxSnark = parseNumberFlag(arg, next);
        index++;
        break;
      case "--start-seed":
        startSeed = parseNumberFlag(arg, next);
        index++;
        break;
      case "--end-seed":
        endSeed = parseNumberFlag(arg, next);
        index++;
        break;
      case "--limit":
        limit = parseNumberFlag(arg, next);
        index++;
        break;
      case "--runtime":
        runtime = parseRuntime(next);
        index++;
        break;
      case "--json":
        json = true;
        break;
      case "--apply":
        apply = true;
        break;
      case "--force-apply":
        forceApply = true;
        break;
      case "--help":
        break;
      default:
        throw new Error(`Unknown flag: ${arg}`);
    }
  }

  return {
    runtime,
    json,
    apply,
    forceApply,
    startSeed,
    endSeed,
    limit,
    filters,
  };
}

function formatFindResult(command: FindCommandOptions, io: CliIo) {
  let lastNonTtyProgressBucket = -1;
  const writeStderr = (chunk: string) => ioWrite(io, "stderr", chunk);
  const results = searchSeeds(command.filters, {
    startSeed: command.startSeed,
    endSeed: command.endSeed,
    limit: command.limit,
    onProgress: (event) => {
      if (event.total < 5_000_000) {
        return;
      }

      if (io?.stderrIsTTY) {
        const suffix = event.done ? "\n" : "\r";
        writeStderr(`${formatProgress(event)}${suffix}`);
        return;
      }

      const bucket = event.done ? 100 : Math.floor((event.scanned / Math.max(1, event.total)) * 20);
      if (!event.done && bucket <= lastNonTtyProgressBucket) {
        return;
      }
      lastNonTtyProgressBucket = bucket;
      writeStderr(`${formatProgress(event)}\n`);
    },
  });
  const resolvedRuntime = resolveRuntime(command.runtime);

  return {
    command: "find",
    runtime: command.runtime,
    resolvedRuntime,
    applied: false,
    applyRequested: command.apply,
    filters: command.filters,
    results: results.map((result) => ({
      seed: result.seed,
      totalStats: result.totalStats,
      rarity: result.buddy.rarity,
      species: result.buddy.species,
      eye: result.buddy.eye,
      hat: result.buddy.hat,
      shiny: result.buddy.shiny,
      stats: result.buddy.stats,
    })),
  };
}

function ioWrite(io: CliIo, stream: "stdout" | "stderr", chunk: string): void {
  if (stream === "stdout") {
    io.writeStdout?.(chunk);
    io.write?.(chunk);
    if (!io.writeStdout && !io.write) {
      process.stdout.write(chunk);
    }
    return;
  }

  io.writeStderr?.(chunk);
  if (!io.writeStderr) {
    process.stderr.write(chunk);
  }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatProgress(event: SearchProgressEvent): string {
  const percent = event.total === 0 ? 100 : (event.scanned / event.total) * 100;
  const elapsedSeconds = Math.max(0.001, event.elapsedMs / 1000);
  const rate = Math.floor(event.scanned / elapsedSeconds);
  const status = event.done ? "done" : "scan";
  return `[progress] ${status} ${percent.toFixed(1)}% scanned=${formatNumber(event.scanned)}/${formatNumber(event.total)} matches=${formatNumber(event.matches)} rate=${formatNumber(rate)}/s`;
}

export async function runCli(
  argv: string[],
  io: CliIo = {
    writeStdout: (chunk) => process.stdout.write(chunk),
    writeStderr: (chunk) => process.stderr.write(chunk),
    stderrIsTTY: process.stderr.isTTY,
  },
): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined || command === "--help" || command === "help") {
    ioWrite(io, "stdout", `${HELP_TEXT}\n`);
    return 0;
  }

  if (command === "doctor") {
    const json = rest.includes("--json");
    const diagnosis = await inspectBuddyIdentityControl();
    const payload = {
      command: "doctor",
      configPath: diagnosis.path,
      envTokenMode: diagnosis.envTokenMode,
      envAccountMetadataMode: diagnosis.envAccountMetadataMode,
      buddyIdSource: diagnosis.buddyIdSource,
      userIDControlsBuddy: diagnosis.userIDControlsBuddy,
      compatibilityMode: diagnosis.compatibilityMode,
      recommendation: diagnosis.recommendation,
      hasUserID:
        typeof diagnosis.config.userID === "string" && diagnosis.config.userID.length > 0,
      hasOauthAccountUuid:
        typeof diagnosis.config.oauthAccount?.accountUuid === "string" &&
        diagnosis.config.oauthAccount.accountUuid.length > 0,
    };

    if (json) {
      ioWrite(io, "stdout", `${JSON.stringify(payload, null, 2)}\n`);
      return 0;
    }

    ioWrite(io, "stdout", `buddyIdSource=${payload.buddyIdSource}\n`);
    ioWrite(io, "stdout", `userIDControlsBuddy=${payload.userIDControlsBuddy}\n`);
    ioWrite(io, "stdout", `${payload.recommendation}\n`);
    return 0;
  }

  if (command !== "find") {
    ioWrite(io, "stderr", `Error: Unknown command: ${command}\n`);
    ioWrite(io, "stdout", `${HELP_TEXT}\n`);
    return 1;
  }

  if (rest.includes("--help")) {
    ioWrite(io, "stdout", `${HELP_TEXT}\n`);
    return 0;
  }

  try {
    const options = parseFindArgs(rest);
    const payload = formatFindResult(options, io);
    const resolvedRuntime = payload.resolvedRuntime as RuntimeMode;

    if (options.apply) {
      const diagnosis = await inspectBuddyIdentityControl();
      if (!diagnosis.userIDControlsBuddy && !options.forceApply) {
        ioWrite(
          io,
          "stderr",
          `Error: userID would not control /buddy. ${diagnosis.recommendation}\n`,
        );
        return 1;
      }

      if (payload.results.length === 0) {
        throw new Error("Cannot apply because no candidate matched the provided filters.");
      }

      if (resolvedRuntime === "bun") {
        if (typeof Bun === "undefined") {
          throw new Error(
            "Bun runtime was requested, but this process is not running under Bun.",
          );
        }
      }

      const selected = payload.results[0]!;
      const appliedUserID = reconstructUidForSeed(selected.seed, {
        runtime: resolvedRuntime,
      });
      const appliedConfig = await applyUserIdToConfig(appliedUserID);

      Object.assign(payload, {
        applied: true,
        appliedUserID,
        configPath: appliedConfig.path,
        warning: appliedConfig.warning,
        forceApplied: options.forceApply,
      });
    }

    if (options.json) {
      ioWrite(io, "stdout", `${JSON.stringify(payload, null, 2)}\n`);
      return 0;
    }

    ioWrite(io, "stdout", `${payload.results.length} candidate(s)\n`);
    for (const result of payload.results) {
      ioWrite(
        io,
        "stdout",
        `${result.seed} ${result.rarity} ${result.species} total=${result.totalStats} shiny=${result.shiny}\n`,
      );
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ioWrite(io, "stderr", `Error: ${message}\n`);
    return 1;
  }
}
