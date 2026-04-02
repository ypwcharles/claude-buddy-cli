import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { generateBuddyFromSeed, getTotalStats } from "./buddy/generate.js";
import { searchSeeds, type SearchProgressEvent } from "./search/search.js";
import type { SearchFilters } from "./search/filters.js";
import { applyUserIdToConfig, inspectBuddyIdentityControl } from "./claude/config.js";
import { resolveRuntime } from "./claude/runtime.js";
import { EYES, HATS, RARITIES, SPECIES, STAT_NAMES } from "./types.js";
import {
  createBunMaterializationState,
  materializeBunUidForSeedChunked,
  reconstructUidForSeed,
  type BunMaterializationResult,
  type BunMaterializationState,
} from "./uid/reconstruct.js";
import {
  getBuddyPreset,
  listBuddyPresets,
  presetSupportsRuntime,
  resolvePresetForRuntime,
} from "./presets/catalog.js";

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
  presetId?: string;
  startSeed?: number;
  endSeed?: number;
  limit?: number;
  stateFile?: string;
  chunkSize?: number;
  laneCount?: number;
  maxSteps?: number;
  searchSeed?: string;
  bunWorkers?: number;
  filters: SearchFilters;
};

type PresetsCommandOptions = {
  runtime: RuntimeMode;
  json: boolean;
  category?: string;
  species?: SearchFilters["species"];
};

type MaterializeCommandOptions = {
  seed: number;
  runtime: RuntimeMode;
  json: boolean;
  apply: boolean;
  forceApply: boolean;
  stateFile?: string;
  chunkSize?: number;
  laneCount?: number;
  maxSteps?: number;
  searchSeed?: string;
  bunWorkers?: number;
};

type BunMaterializationEnvelope = {
  version: 1;
  runtime: "bun";
  state: BunMaterializationState;
  found?: BunMaterializationResult;
};

const SPECIES_VALUES = SPECIES.join(", ");
const RARITY_VALUES = RARITIES.join(", ");
const EYE_VALUES = EYES.join(", ");
const HAT_VALUES = HATS.join(", ");
const STAT_VALUES = STAT_NAMES.join(", ");
const UINT32_MAX = 0xffff_ffff;
const UINT32_LIMIT = 0x1_0000_0000;
const FULL421_PRESET_COUNT = listBuddyPresets().filter(
  (preset) => preset.category === "full421",
).length;
const SPECIES_SHINY_MAX_PRESET_COUNT = listBuddyPresets().filter(
  (preset) => preset.category === "species-shiny-max",
).length;
const SPECIES_SHINY_MAX_SPECIES_COUNT = new Set(
  listBuddyPresets()
    .filter((preset) => preset.category === "species-shiny-max")
    .map((preset) => preset.filters.species)
    .filter((species): species is SearchFilters["species"] => species !== undefined),
).size;

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
  claude-buddy materialize --seed <n> [flags]
  claude-buddy presets [--runtime <mode>] [--category <name>] [--species <name>] [--json]
  claude-buddy doctor [--json]

FIND FLAGS / 查询参数
  --preset <id>             使用内置 preset / Use a built-in preset
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
  --state-file <path>       Bun 精确 preset/materialize 的进度文件 / Resume state file for Bun exact preset/materialize
  --chunk-size <n>          Bun 精确 materialize 每步扫描量 / Chunk size for Bun exact materialization
  --lane-count <n>          Bun 精确 materialize lane 数量 / Lane count for Bun exact materialization
  --max-steps <n>           Bun 精确 materialize 最多执行多少步 / Maximum steps for Bun exact materialization
  --search-seed <text>      固定 Bun 精确 materialize campaign / Fix Bun exact materialization campaign
  --bun-workers <n>         Bun 精确 materialize worker 数 / Worker count for Bun exact materialization
  --runtime <mode>          auto | node | bun
  --json                    stdout 输出 JSON / Print machine-readable JSON to stdout
  --apply                   将选中的 uid 写入 ~/.claude.json / Write selected uid
  --force-apply             即使 userID 不生效也强制写入 / Force write userID
  --help                    打印帮助 / Print this help

FIND VALUE ENUMS / 可选值
  species: ${SPECIES_VALUES}
  rarity: ${RARITY_VALUES}
  eye: ${EYE_VALUES}
  hat: ${HAT_VALUES}
  shiny: true | false
  stats: ${STAT_VALUES} (single stat range: 1..100, current generator total max: 421)

GENERATION LIMITS / 生成硬限制
  seed space: 2^32 = 4,294,967,296
  max reachable buddies: <= 4,294,967,296 (seed-determined upper bound)
  stats hard limits: each stat 1..100, current generator total max: 421
  structural rule: rarity=common always forces hat=none
  feasibility: not all filter combinations are reachable; zero results in a full scan means no such buddy exists in this seed space

PRESETS FLAGS / 预设查询参数
  --runtime <mode>          auto | node | bun
  --category <name>         按预设分类筛选 / Filter by preset category
  --species <name>          按预设目标物种筛选 / Filter preset target species
  --json                    stdout 输出 JSON / Print machine-readable JSON to stdout
  --help                    打印帮助 / Print this help

PRESET CATEGORY ENUMS / 预设分类可选值
  curated
  full421
  species-shiny-max

RESEARCH PRESET SEEDS / 研究预设种子集
  full421 presets: ${FULL421_PRESET_COUNT} (all known total=421 buddies)
  shiny max presets: ${SPECIES_SHINY_MAX_PRESET_COUNT} (covers ${SPECIES_SHINY_MAX_SPECIES_COUNT} species, includes tied maxima)
  these built-in preset seeds are sourced from buddy-research-2026-04-02

MATERIALIZE FLAGS / 精确反推参数
  --seed <n>                目标 seed / Target seed
  --runtime <mode>          auto | node | bun
  --state-file <path>       Bun 进度文件，可断点续跑 / Bun resume state file
  --chunk-size <n>          每轮每条 lane 扫描的 suffix 数 / Suffixes per lane per step
  --lane-count <n>          Bun prefix lane 数量 / Number of Bun prefix lanes
  --max-steps <n>           最多执行多少轮扫描 / Maximum materialization steps
  --search-seed <text>      固定 Bun 搜索 campaign / Fix Bun search campaign
  --bun-workers <n>         Bun 精确扫描 worker 数 / Worker count for Bun exact scan
  --json                    stdout 输出 JSON / Print machine-readable JSON to stdout
  --apply                   找到后写入 ~/.claude.json / Apply after a userID is found
  --force-apply             即使 userID 不生效也强制写入 / Force write userID
  --help                    打印帮助 / Print this help

EXAMPLES / 示例
  claude-buddy presets --json
  claude-buddy presets --category full421 --json
  claude-buddy presets --category species-shiny-max --json
  claude-buddy presets --category species-shiny-max --species dragon --json
  claude-buddy find --preset capybara-shiny-min-wisdom-51 --runtime bun --json
  claude-buddy find --preset full421-rabbit-130412512 --runtime node --json
  claude-buddy find --preset shiny-max-dragon-3716311402 --runtime bun --json
  claude-buddy find --species dragon --shiny true --min-total 400 --json
  claude-buddy find --species duck --rarity common --limit 5
  claude-buddy materialize --seed 3716311402 --runtime bun --state-file /tmp/buddy-state.json --max-steps 5 --json
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

function assertIntegerInRange(
  flag: string,
  value: number | undefined,
  minimum: number,
  maximum: number,
): void {
  if (value === undefined) {
    return;
  }
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Invalid value for ${flag}: ${value}. Expected integer in [${minimum}, ${maximum}].`);
  }
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
  let presetId: string | undefined;
  let startSeed: number | undefined;
  let endSeed: number | undefined;
  let limit: number | undefined;
  let stateFile: string | undefined;
  let chunkSize: number | undefined;
  let laneCount: number | undefined;
  let maxSteps: number | undefined;
  let searchSeed: string | undefined;
  let bunWorkers: number | undefined;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case "--preset":
        presetId = next;
        index++;
        break;
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
      case "--state-file":
        stateFile = next;
        index++;
        break;
      case "--chunk-size":
        chunkSize = parseNumberFlag(arg, next);
        index++;
        break;
      case "--lane-count":
        laneCount = parseNumberFlag(arg, next);
        index++;
        break;
      case "--max-steps":
        maxSteps = parseNumberFlag(arg, next);
        index++;
        break;
      case "--search-seed":
        searchSeed = next;
        index++;
        break;
      case "--bun-workers":
        bunWorkers = parseNumberFlag(arg, next);
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

  assertIntegerInRange("--start-seed", startSeed, 0, UINT32_LIMIT);
  assertIntegerInRange("--end-seed", endSeed, 0, UINT32_LIMIT);
  if (
    startSeed !== undefined &&
    endSeed !== undefined &&
    endSeed < startSeed
  ) {
    throw new Error(`Invalid seed range: --end-seed (${endSeed}) must be >= --start-seed (${startSeed}).`);
  }

  return {
    runtime,
    json,
    apply,
    forceApply,
    presetId,
    startSeed,
    endSeed,
    limit,
    stateFile,
    chunkSize,
    laneCount,
    maxSteps,
    searchSeed,
    bunWorkers,
    filters,
  };
}

function parsePresetsArgs(argv: string[]): PresetsCommandOptions {
  let runtime: RuntimeMode = "auto";
  let json = false;
  let category: string | undefined;
  let species: SearchFilters["species"] | undefined;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case "--runtime":
        runtime = parseRuntime(next);
        index++;
        break;
      case "--category":
        category = next;
        index++;
        break;
      case "--species":
        species = next as SearchFilters["species"];
        index++;
        break;
      case "--json":
        json = true;
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
    category,
    species,
  };
}

function parseMaterializeArgs(argv: string[]): MaterializeCommandOptions {
  let seed: number | undefined;
  let runtime: RuntimeMode = "auto";
  let json = false;
  let apply = false;
  let forceApply = false;
  let stateFile: string | undefined;
  let chunkSize: number | undefined;
  let laneCount: number | undefined;
  let maxSteps: number | undefined;
  let searchSeed: string | undefined;
  let bunWorkers: number | undefined;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case "--seed":
        seed = parseNumberFlag(arg, next);
        index++;
        break;
      case "--runtime":
        runtime = parseRuntime(next);
        index++;
        break;
      case "--state-file":
        stateFile = next;
        index++;
        break;
      case "--chunk-size":
        chunkSize = parseNumberFlag(arg, next);
        index++;
        break;
      case "--lane-count":
        laneCount = parseNumberFlag(arg, next);
        index++;
        break;
      case "--max-steps":
        maxSteps = parseNumberFlag(arg, next);
        index++;
        break;
      case "--search-seed":
        searchSeed = next;
        index++;
        break;
      case "--bun-workers":
        bunWorkers = parseNumberFlag(arg, next);
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

  if (seed === undefined) {
    throw new Error("Missing required flag: --seed");
  }
  assertIntegerInRange("--seed", seed, 0, UINT32_MAX);

  return {
    seed,
    runtime,
    json,
    apply,
    forceApply,
    stateFile,
    chunkSize,
    laneCount,
    maxSteps,
    searchSeed,
    bunWorkers,
  };
}

function formatPresetMetadata(
  preset: ReturnType<typeof listBuddyPresets>[number],
  resolvedRuntime: "node" | "bun",
) {
  return {
    id: preset.id,
    name: preset.name,
    description: preset.description,
    category: preset.category,
    source: preset.source,
    filters: preset.filters,
    availableRuntimes: {
      node: preset.node !== undefined,
      bun: presetSupportsRuntime(preset, "bun"),
    },
    availableInResolvedRuntime:
      presetSupportsRuntime(preset, resolvedRuntime),
  };
}

function formatPresetsResult(command: PresetsCommandOptions) {
  const resolvedRuntime = resolveRuntime(command.runtime);
  const allPresets = listBuddyPresets();
  const filteredPresets = allPresets.filter((preset) => {
    if (
      command.category !== undefined &&
      (preset.category ?? "curated") !== command.category
    ) {
      return false;
    }
    if (
      command.species !== undefined &&
      preset.filters.species !== command.species
    ) {
      return false;
    }
    return true;
  });
  const shinyMaxSpeciesCount = new Set(
    allPresets
      .filter((preset) => preset.category === "species-shiny-max")
      .map((preset) => preset.filters.species)
      .filter((species): species is SearchFilters["species"] => species !== undefined),
  ).size;

  return {
    command: "presets",
    runtime: command.runtime,
    resolvedRuntime,
    filters: {
      ...(command.category !== undefined ? { category: command.category } : {}),
      ...(command.species !== undefined ? { species: command.species } : {}),
    },
    researchPresetSummary: {
      full421PresetCount: allPresets.filter((preset) => preset.category === "full421")
        .length,
      speciesShinyMaxPresetCount: allPresets.filter(
        (preset) => preset.category === "species-shiny-max",
      ).length,
      speciesShinyMaxSpeciesCount: shinyMaxSpeciesCount,
      speciesShinyMaxIncludesTies: true,
      source: "buddy-research-2026-04-02",
    },
    presets: filteredPresets.map((preset) => ({
      ...formatPresetMetadata(preset, resolvedRuntime),
      seed:
        resolvedRuntime === "node"
          ? preset.node?.seed
          : preset.bun?.seed ?? preset.bunTargetSeeds?.[0] ?? preset.node?.seed,
    })),
  };
}

function formatCandidateResult(result: {
  seed: number;
  totalStats: number;
  rarity: string;
  species: string;
  eye: string;
  hat: string;
  shiny: boolean;
  stats: Record<string, number>;
  userID?: string;
}) {
  return {
    seed: result.seed,
    totalStats: result.totalStats,
    rarity: result.rarity,
    species: result.species,
    eye: result.eye,
    hat: result.hat,
    shiny: result.shiny,
    stats: result.stats,
    ...(result.userID ? { userID: result.userID } : {}),
  };
}

function buildCandidateFromSeed(seed: number) {
  const buddy = generateBuddyFromSeed(seed);
  return formatCandidateResult({
    seed: seed >>> 0,
    totalStats: getTotalStats(buddy.stats),
    rarity: buddy.rarity,
    species: buddy.species,
    eye: buddy.eye,
    hat: buddy.hat,
    shiny: buddy.shiny,
    stats: buddy.stats,
  });
}

async function formatFindResult(command: FindCommandOptions, io: CliIo) {
  const resolvedRuntime = resolveRuntime(command.runtime);

  if (command.presetId) {
    const preset = getBuddyPreset(command.presetId);
    if (!preset) {
      throw new Error(`Unknown preset: ${command.presetId}`);
    }

    if (!presetSupportsRuntime(preset, resolvedRuntime)) {
      throw new Error(`Preset ${command.presetId} is not available for ${resolvedRuntime} runtime.`);
    }

    if (resolvedRuntime === "node") {
      const resolvedPreset = resolvePresetForRuntime(command.presetId, resolvedRuntime);

      return {
        command: "find",
        runtime: command.runtime,
        resolvedRuntime,
        applied: false,
        applyRequested: command.apply,
        filters: resolvedPreset.preset.filters,
        preset: formatPresetMetadata(resolvedPreset.preset, resolvedRuntime),
        searchStrategy: resolvedPreset.searchStrategy,
        results: [formatCandidateResult(resolvedPreset.result)],
      };
    }

    const targetSeeds = Array.from(
      preset.bunTargetSeeds ??
        (preset.node ? [preset.node.seed] : preset.bun ? [preset.bun.seed] : []),
    );
    if (targetSeeds.length === 0) {
      throw new Error(`Preset ${command.presetId} is not available for bun runtime.`);
    }

    const limit = Math.max(1, command.limit ?? 20);
    const results = Array.from(new Set(targetSeeds.map((seed) => seed >>> 0)))
      .slice(0, limit)
      .map((seed) => buildCandidateFromSeed(seed));

    return {
      command: "find",
      runtime: command.runtime,
      resolvedRuntime,
      applied: false,
      applyRequested: command.apply,
      filters: preset.filters,
      preset: formatPresetMetadata(preset, resolvedRuntime),
      searchStrategy: "preset-bun-seed",
      results,
    };
  }

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

  return {
    command: "find",
    runtime: command.runtime,
    resolvedRuntime,
    applied: false,
    applyRequested: command.apply,
    filters: command.filters,
    searchStrategy: "seed-search",
    results: results.map((result) =>
      formatCandidateResult({
        seed: result.seed,
        totalStats: result.totalStats,
        rarity: result.buddy.rarity,
        species: result.buddy.species,
        eye: result.buddy.eye,
        hat: result.buddy.hat,
        shiny: result.buddy.shiny,
        stats: result.buddy.stats,
      }),
    ),
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

function isUserIdApplyBlocked(
  diagnosis: Awaited<ReturnType<typeof inspectBuddyIdentityControl>>,
): boolean {
  return (
    diagnosis.compatibilityMode === "env-token-blocked-by-config-oauthAccount" ||
    diagnosis.compatibilityMode === "env-token-blocked-by-env-account-metadata" ||
    diagnosis.compatibilityMode === "standard-login-oauthAccount-active"
  );
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

async function readBunMaterializationEnvelope(
  stateFile: string,
): Promise<BunMaterializationEnvelope | undefined> {
  try {
    const raw = await readFile(stateFile, "utf8");
    return JSON.parse(raw) as BunMaterializationEnvelope;
  } catch (error) {
    const errno = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    if (errno === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function writeBunMaterializationEnvelope(
  stateFile: string,
  envelope: BunMaterializationEnvelope,
): Promise<void> {
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
}

function slugForStateFile(text: string): string {
  return text.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function getAutoPresetMaterializeStateFile(
  presetId: string,
  seed: number,
): string {
  return path.join(
    os.tmpdir(),
    "claude-buddy-materialize",
    `${slugForStateFile(presetId)}-${seed >>> 0}.json`,
  );
}

function formatMaterializationProgress(state: BunMaterializationState) {
  return {
    scanned: state.scanned,
    laneCount: state.laneCount,
    chunkSize: state.chunkSize,
    nextPrefixAttempt: state.nextPrefixAttempt,
    completedLanes: state.lanes.filter((lane) => lane.completed).length,
    lanes: state.lanes.map((lane) => ({
      prefixAttempt: lane.prefixAttempt,
      nextSuffix: lane.nextSuffix,
      completed: lane.completed,
    })),
  };
}

async function formatMaterializeResult(
  command: MaterializeCommandOptions,
): Promise<{
  command: "materialize";
  runtime: RuntimeMode;
  resolvedRuntime: "node" | "bun";
  seed: number;
  applied: boolean;
  applyRequested: boolean;
  searchStrategy: "node-seed-reconstruction" | "bun-exact-materialization";
  result?: { seed: number; userID: string; prefixAttempt?: number; suffix?: number };
  done: boolean;
  resumed: boolean;
  stateFile?: string;
  progress?: ReturnType<typeof formatMaterializationProgress>;
  state?: BunMaterializationState;
}> {
  const resolvedRuntime = resolveRuntime(command.runtime);

  if (resolvedRuntime === "node") {
    return {
      command: "materialize",
      runtime: command.runtime,
      resolvedRuntime,
      seed: command.seed >>> 0,
      applied: false,
      applyRequested: command.apply,
      searchStrategy: "node-seed-reconstruction",
      result: {
        seed: command.seed >>> 0,
        userID: reconstructUidForSeed(command.seed, { runtime: "node" }),
      },
      done: true,
      resumed: false,
      stateFile: command.stateFile,
    };
  }

  if (typeof Bun === "undefined") {
    throw new Error(
      "Bun runtime was requested, but this process is not running under Bun.",
    );
  }

  let resumed = false;
  let envelope: BunMaterializationEnvelope | undefined;
  if (command.stateFile) {
    envelope = await readBunMaterializationEnvelope(command.stateFile);
  }

  let state: BunMaterializationState;
  let found = envelope?.found;

  if (envelope) {
    resumed = true;
    state = envelope.state;
    if (!Number.isFinite(state.nextPrefixAttempt)) {
      state.nextPrefixAttempt =
        Math.max(-1, ...state.lanes.map((lane) => lane.prefixAttempt)) + 1;
    }
    if ((state.targetSeed >>> 0) !== (command.seed >>> 0)) {
      throw new Error(
        `State file seed ${state.targetSeed} does not match requested seed ${command.seed}.`,
      );
    }
    if (
      command.searchSeed !== undefined &&
      command.searchSeed !== state.searchSeed
    ) {
      throw new Error("State file searchSeed does not match requested --search-seed.");
    }
    if (
      command.laneCount !== undefined &&
      command.laneCount !== state.laneCount
    ) {
      throw new Error("State file laneCount does not match requested --lane-count.");
    }
    if (
      command.chunkSize !== undefined &&
      command.chunkSize !== state.chunkSize
    ) {
      throw new Error("State file chunkSize does not match requested --chunk-size.");
    }
  } else {
    state = createBunMaterializationState(command.seed, {
      searchSeed: command.searchSeed,
      laneCount: command.laneCount,
      chunkSize: command.chunkSize,
    });
  }

  if (!found) {
    const step = materializeBunUidForSeedChunked(command.seed, {
      state,
      maxSteps: command.maxSteps,
      bunWorkers: command.bunWorkers,
    });
    found = step.found;
  }

  if (command.stateFile) {
    await writeBunMaterializationEnvelope(command.stateFile, {
      version: 1,
      runtime: "bun",
      state,
      ...(found ? { found } : {}),
    });
  }

  return {
    command: "materialize",
    runtime: command.runtime,
    resolvedRuntime,
    seed: command.seed >>> 0,
    applied: false,
    applyRequested: command.apply,
    searchStrategy: "bun-exact-materialization",
    ...(found
      ? {
          result: {
            seed: found.seed,
            userID: found.userID,
            prefixAttempt: found.prefixAttempt,
            suffix: found.suffix,
          },
        }
      : {}),
    done: found !== undefined,
    resumed,
    stateFile: command.stateFile,
    progress: formatMaterializationProgress(state),
    ...(!command.stateFile && found === undefined ? { state } : {}),
  };
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

  if (command === "presets") {
    if (rest.includes("--help")) {
      ioWrite(io, "stdout", `${HELP_TEXT}\n`);
      return 0;
    }

    try {
      const options = parsePresetsArgs(rest);
      const payload = formatPresetsResult(options);

      if (options.json) {
        ioWrite(io, "stdout", `${JSON.stringify(payload, null, 2)}\n`);
        return 0;
      }

      ioWrite(io, "stdout", `${payload.presets.length} preset(s)\n`);
      for (const preset of payload.presets) {
        ioWrite(
          io,
          "stdout",
          `${preset.id} runtime=${payload.resolvedRuntime} available=${preset.availableInResolvedRuntime}\n`,
        );
      }
      return 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ioWrite(io, "stderr", `Error: ${message}\n`);
      return 1;
    }
  }

  if (command === "materialize") {
    if (rest.includes("--help")) {
      ioWrite(io, "stdout", `${HELP_TEXT}\n`);
      return 0;
    }

    try {
      const options = parseMaterializeArgs(rest);
      const payload = await formatMaterializeResult(options);

      if (options.apply) {
        const diagnosis = await inspectBuddyIdentityControl();
        if (isUserIdApplyBlocked(diagnosis) && !options.forceApply) {
          ioWrite(
            io,
            "stderr",
            `Error: userID would not control /buddy. ${diagnosis.recommendation}\n`,
          );
          return 1;
        }

        if (!payload.result) {
          throw new Error(
            "Cannot apply because no userID has been materialized yet. Resume the materialization first.",
          );
        }

        const appliedConfig = await applyUserIdToConfig(payload.result.userID);
        Object.assign(payload, {
          applied: true,
          appliedUserID: payload.result.userID,
          appliedSeed: payload.result.seed,
          appliedResult: payload.result,
          appliedStrategy: payload.searchStrategy,
          configPath: appliedConfig.path,
          warning: appliedConfig.warning,
          backupPath: appliedConfig.backupPath,
          forceApplied: options.forceApply,
        });
      }

      if (options.json) {
        ioWrite(io, "stdout", `${JSON.stringify(payload, null, 2)}\n`);
        return 0;
      }

      if (payload.result) {
        ioWrite(
          io,
          "stdout",
          `seed=${payload.result.seed} userID=${payload.result.userID} strategy=${payload.searchStrategy}\n`,
        );
      } else {
        ioWrite(
          io,
          "stdout",
          `seed=${payload.seed} strategy=${payload.searchStrategy} done=${payload.done} scanned=${payload.progress?.scanned ?? 0}\n`,
        );
      }
      return 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ioWrite(io, "stderr", `Error: ${message}\n`);
      return 1;
    }
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
    const payload = await formatFindResult(options, io);
    const resolvedRuntime = payload.resolvedRuntime as RuntimeMode;

    if (options.apply) {
      const diagnosis = await inspectBuddyIdentityControl();
      if (isUserIdApplyBlocked(diagnosis) && !options.forceApply) {
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
      let appliedUserID: string;
      let appliedSeed = selected.seed;
      let appliedResult = selected;
      let appliedStrategy:
        | "seed-reconstruction"
        | "bun-seed-materialization"
        | "preset-node-seed"
        | "preset-bun-seed-materialization" =
        "seed-reconstruction";

      if ("userID" in selected && typeof selected.userID === "string") {
        appliedUserID = String(selected.userID);
      } else if (resolvedRuntime === "bun") {
        const stateFile =
          options.stateFile ??
          getAutoPresetMaterializeStateFile(
            options.presetId ?? `seed-${selected.seed >>> 0}`,
            selected.seed,
          );
        const materialized = await formatMaterializeResult({
          seed: selected.seed,
          runtime: "bun",
          json: options.json,
          apply: false,
          forceApply: false,
          stateFile,
          searchSeed:
            options.searchSeed ??
            (options.stateFile === undefined ? `find-seed:${selected.seed >>> 0}` : undefined),
          chunkSize: options.chunkSize,
          laneCount: options.laneCount,
          maxSteps: options.maxSteps,
          bunWorkers: options.bunWorkers,
        });

        if (!materialized.result) {
          throw new Error(
            `Unable to materialize userID for seed ${selected.seed} yet. Resume with --state-file ${stateFile}.`,
          );
        }

        appliedUserID = materialized.result.userID;
        appliedSeed = materialized.result.seed;
        appliedResult = {
          ...selected,
          userID: appliedUserID,
        };
        if (payload.results.length > 0) {
          payload.results[0] = appliedResult;
        }
        appliedStrategy =
          options.presetId !== undefined
            ? "preset-bun-seed-materialization"
            : "bun-seed-materialization";
      } else {
        appliedUserID = reconstructUidForSeed(selected.seed, {
          runtime: resolvedRuntime,
        });
        if (options.presetId !== undefined) {
          appliedStrategy = "preset-node-seed";
        }
      }

      const appliedConfig = await applyUserIdToConfig(appliedUserID);

      Object.assign(payload, {
        applied: true,
        appliedUserID,
        appliedSeed,
        appliedResult,
        appliedStrategy,
        configPath: appliedConfig.path,
        warning: appliedConfig.warning,
        backupPath: appliedConfig.backupPath,
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
