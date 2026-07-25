import { readFileSync } from 'node:fs';

export interface ChecklistFact {
  id: string;
  patterns: string[];
  weight: number;
}

export interface ChecklistConfig {
  min_score: number;
  facts: ChecklistFact[];
}

export interface QualityResult {
  score: number;
  matched: string[];
  missed: string[];
  pass: boolean;
}

export function loadChecklist(path: string): ChecklistConfig {
  return JSON.parse(readFileSync(path, 'utf8')) as ChecklistConfig;
}

export function scoreReport(reportText: string, checklist: ChecklistConfig): QualityResult {
  const lower = reportText.toLowerCase();
  const matched: string[] = [];
  const missed: string[] = [];
  let earned = 0;
  let total = 0;

  for (const fact of checklist.facts) {
    total += fact.weight;
    const hit = fact.patterns.some((p) => {
      try {
        return new RegExp(p, 'i').test(lower);
      } catch {
        return lower.includes(p.toLowerCase());
      }
    });
    if (hit) {
      matched.push(fact.id);
      earned += fact.weight;
    } else {
      missed.push(fact.id);
    }
  }

  const score = total > 0 ? earned / total : 0;
  return {
    score: Math.round(score * 1000) / 1000,
    matched,
    missed,
    pass: score >= checklist.min_score,
  };
}
