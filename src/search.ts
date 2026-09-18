import type { BugRecord, SearchResult } from "./types";

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "for",
  "from", "has", "have", "i", "in", "is", "it", "of", "on", "or", "that",
  "the", "this", "to", "was", "when", "with", "user", "users", "bug", "issue"
]);

const REPLACEMENTS: Array<[RegExp, string]> = [
  [/\b(log[ -]?in|sign[ -]?in|signin)\b/g, "login"],
  [/\b(log[ -]?out|sign[ -]?out|signout)\b/g, "logout"],
  [/\b(freez(?:e|es|ing)|froze|frozen|hang(?:s|ing)?|hung|stuck|unresponsive)\b/g, "freeze"],
  [/\b(crash(?:es|ed|ing)?)\b/g, "crash"],
  [/\b(load(?:s|ed|ing)?|spinner|progress indicator)\b/g, "loading"],
  [/\b(fail(?:s|ed|ing|ure)?|error(?:s|ed)?)\b/g, "error"],
  [/\b(click(?:s|ed|ing)?|tap(?:s|ped|ping)?)\b/g, "click"],
  [/\b(save(?:s|d|ing)?|submit(?:s|ted|ting)?)\b/g, "submit"],
  [/\b(blank|empty|white) screen\b/g, "blank-screen"]
];

export function normalizeText(input: string): string {
  let value = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ");

  for (const [pattern, replacement] of REPLACEMENTS) {
    value = value.replace(pattern, replacement);
  }

  return value
    .replace(/[^a-z0-9#_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(input: string): Set<string> {
  return new Set(
    normalizeText(input)
      .split(" ")
      .filter((token) => token.length >= 2 && !STOP_WORDS.has(token))
  );
}

function dice<T>(left: Set<T>, right: Set<T>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const item of left) if (right.has(item)) overlap += 1;
  return (2 * overlap) / (left.size + right.size);
}

function trigrams(input: string): Set<string> {
  const normalized = `  ${normalizeText(input)}  `;
  const grams = new Set<string>();
  for (let i = 0; i <= normalized.length - 3; i += 1) {
    grams.add(normalized.slice(i, i + 3));
  }
  return grams;
}

function identifiers(input: string): Set<string> {
  const matches = normalizeText(input).match(/(?:[a-z]+[-_]?)?\d{2,}|\b\d+[a-z]+\b/g);
  return new Set(matches ?? []);
}

function scoreBug(query: string, bug: BugRecord): SearchResult {
  const normalizedQuery = normalizeText(query);
  const normalizedTitle = normalizeText(bug.title);
  const combined = `${bug.title} ${bug.description}`;

  if (normalizedQuery && normalizedQuery === normalizedTitle) {
    return { bug, score: 1, reasons: ["exact title"] };
  }

  const titleScore = dice(tokens(query), tokens(bug.title));
  const combinedScore = dice(tokens(query), tokens(combined));
  const characterScore = dice(trigrams(query), trigrams(combined));
  let score = titleScore * 0.46 + combinedScore * 0.34 + characterScore * 0.2;
  const reasons: string[] = [];

  if (normalizedQuery.length >= 8 && normalizedTitle.includes(normalizedQuery)) {
    score = Math.max(score, 0.93);
    reasons.push("title contains the description");
  } else if (normalizedTitle.length >= 8 && normalizedQuery.includes(normalizedTitle)) {
    score = Math.max(score, 0.88);
    reasons.push("description contains the title");
  }

  const queryIds = identifiers(query);
  const bugIds = identifiers(combined);
  const sharedIds = [...queryIds].filter((id) => bugIds.has(id));
  if (sharedIds.length > 0) {
    score = Math.min(1, score + 0.16);
    reasons.push(`same identifier: ${sharedIds.slice(0, 2).join(", ")}`);
  } else if (queryIds.size > 0 && bugIds.size > 0) {
    score *= 0.88;
  }

  if (titleScore >= 0.7) reasons.push("strong title-word overlap");
  else if (combinedScore >= 0.55) reasons.push("description-word overlap");
  if (characterScore >= 0.65) reasons.push("similar phrasing");

  return { bug, score: Math.max(0, Math.min(1, score)), reasons };
}

export function searchBugs(query: string, bugs: BugRecord[], limit = 3): SearchResult[] {
  return bugs
    .map((bug) => scoreBug(query, bug))
    .sort((a, b) => b.score - a.score || b.bug.number - a.bug.number)
    .slice(0, Math.max(1, limit));
}
