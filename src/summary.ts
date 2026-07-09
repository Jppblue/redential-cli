import type { Bundle } from "./types.js";

/**
 * Renders a human-facing "wrapped" summary of an already-computed bundle for
 * TTY stdout. Pure formatting only — every value comes from `Bundle`, no new
 * data collection, no network. See `docs/scan.md`.
 */

const WIDTH = 60;

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const GRAY = "\x1b[90m";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SPARK_LEVELS = ["·", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

function humanizeSpan(days: number): string {
  if (days <= 0) return "a single day";
  const years = Math.floor(days / 365);
  if (years >= 1) return `${years} year${years === 1 ? "" : "s"}`;
  const months = Math.floor(days / 30);
  if (months >= 1) return `${months} month${months === 1 ? "" : "s"}`;
  return `${days} day${days === 1 ? "" : "s"}`;
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function bar(fraction: number, width: number): string {
  const clamped = Math.max(0, Math.min(1, fraction));
  const filled = Math.round(clamped * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function sparkline(values: number[]): string {
  const max = Math.max(...values, 0);
  if (max === 0) return SPARK_LEVELS[0].repeat(values.length);
  return values
    .map((v) => {
      if (v === 0) return SPARK_LEVELS[0];
      const level = Math.max(1, Math.round((v / max) * (SPARK_LEVELS.length - 1)));
      return SPARK_LEVELS[level];
    })
    .join("");
}

function hourAxis(): string {
  const chars = new Array(24).fill(" ");
  for (const [pos, label] of [
    [0, "0"],
    [6, "6"],
    [12, "12"],
    [18, "18"],
  ] as const) {
    for (let i = 0; i < label.length; i++) chars[pos + i] = label[i];
  }
  return chars.join("");
}

function heading(label: string): string {
  return `  ${BOLD}${GRAY}${label}${RESET}`;
}

function sectionOrTeaser<T>(items: T[], render: (items: T[]) => string[], teaser: string): string[] {
  return items.length > 0 ? render(items) : [`  ${DIM}${teaser}${RESET}`];
}

function weekdaySection(histogram: number[]): string[] {
  const max = Math.max(...histogram, 1);
  const barWidth = 20;
  return histogram.map((count, i) => {
    const filled = Math.round((count / max) * barWidth);
    const b = "█".repeat(filled) + "░".repeat(barWidth - filled);
    return `  ${WEEKDAY_LABELS[i]}  ${GREEN}${b}${RESET}  ${count}`;
  });
}

function shareSection(
  items: Array<{ label: string; share: number; suffix?: string }>,
  maxItems: number
): string[] {
  const top = [...items].sort((a, b) => b.share - a.share).slice(0, maxItems);
  const max = Math.max(...top.map((i) => i.share), 0.0001);
  const labelWidth = Math.max(...top.map((i) => i.label.length), 4);
  return top.map((item) => {
    const b = bar(item.share / max, 20);
    const label = item.label.padEnd(labelWidth);
    const suffix = item.suffix ? `  ${DIM}${item.suffix}${RESET}` : "";
    return `  ${label}  ${GREEN}${b}${RESET}  ${YELLOW}${pct(item.share).padStart(4)}${RESET}${suffix}`;
  });
}

function skillsSection(bundle: Bundle): string[] {
  const skills = [...bundle.detected_skills].sort((a, b) => b.commit_count - a.commit_count);
  if (skills.length === 0) {
    return [
      `  ${DIM}No skills detected yet — signature matching covers 100+`,
      `  technologies (auth, payments, AI, infra, and more). Keep`,
      `  committing and rerun \`redential scan\`.${RESET}`,
    ];
  }
  const shown = skills.slice(0, 8);
  const labelWidth = Math.max(...shown.map((s) => s.slug.length), 4);
  const lines = shown.map(
    (s) => `  ${s.slug.padEnd(labelWidth)}  ${GREEN}${String(s.commit_count).padStart(4)} commits${RESET}`
  );
  if (skills.length > shown.length) {
    lines.push(`  ${DIM}+${skills.length - shown.length} more${RESET}`);
  }
  return lines;
}

export function formatSummary(bundle: Bundle): string {
  const lines: string[] = [];

  const title = "YOUR PRIVATE REPO, WRAPPED";
  const pad = Math.max(0, Math.floor((WIDTH - title.length) / 2));
  lines.push(`  ${CYAN}${"╔" + "═".repeat(WIDTH) + "╗"}${RESET}`);
  lines.push(
    `  ${CYAN}║${RESET}${" ".repeat(pad)}${BOLD}${CYAN}${title}${RESET}${" ".repeat(
      WIDTH - pad - title.length
    )}${CYAN}║${RESET}`
  );
  lines.push(`  ${CYAN}${"╚" + "═".repeat(WIDTH) + "╝"}${RESET}`);
  lines.push("");

  const commitCount = bundle.commits.user_total.toLocaleString("en-US");
  lines.push(
    `  ${BOLD}${humanizeSpan(bundle.commits.span_days)}, ${commitCount} commits${RESET}`
  );
  lines.push("");

  lines.push(heading("COMMITS BY HOUR (UTC)"));
  lines.push(`  ${hourAxis()}`);
  lines.push(`  ${GREEN}${sparkline(bundle.commits.hour_histogram)}${RESET}`);
  lines.push("");

  lines.push(heading("COMMITS BY WEEKDAY"));
  lines.push(...weekdaySection(bundle.commits.weekday_histogram));
  lines.push("");

  lines.push(heading("TOP LANGUAGES"));
  lines.push(
    ...sectionOrTeaser(
      bundle.languages,
      (langs) => shareSection(langs.map((l) => ({ label: l.extension, share: l.share })), 5),
      "No language data — every change so far was excluded (lockfiles, build output, generated dumps)."
    )
  );
  lines.push("");

  lines.push(heading("TOP CATEGORIES"));
  lines.push(
    ...sectionOrTeaser(
      bundle.categories,
      (cats) =>
        shareSection(
          cats.map((c) => ({
            label: c.name,
            share: c.churn_share,
            suffix: `(${c.commit_count} commit${c.commit_count === 1 ? "" : "s"})`,
          })),
          5
        ),
      "No category data yet."
    )
  );
  lines.push("");

  lines.push(heading("SKILLS DETECTED"));
  lines.push(...skillsSection(bundle));
  lines.push("");

  lines.push(
    `  ${BOLD}Ownership${RESET}       ${YELLOW}${pct(bundle.ownership.user_commit_ratio)}${RESET} of this repo's commits are yours`
  );
  lines.push(
    `  ${BOLD}Signed commits${RESET}  ${YELLOW}${pct(bundle.signed.ratio)}${RESET} of your commits are cryptographically signed`
  );
  lines.push("");

  lines.push(
    `  ${DIM}Nothing left your machine. Verify: github.com/Jppblue/redential-cli${RESET}`
  );
  lines.push("");
  lines.push(`  ${GRAY}${"─".repeat(WIDTH)}${RESET}`);

  return lines.join("\n");
}
