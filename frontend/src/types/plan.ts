export type PlanDiscipline = 'architectural' | 'electrical' | 'structural' | 'plumbing' | 'fire';

export interface DisciplineInfo {
  id: PlanDiscipline;
  label: string;
  badgeClass: string;
  pillActiveClass: string;
  estimatorLabel: string;
  estimatorDesc: string;
}

export const DISCIPLINES: DisciplineInfo[] = [
  {
    id: 'architectural',
    label: 'Architectural',
    badgeClass: 'bg-zinc-900 border-zinc-700/80 text-zinc-300',
    pillActiveClass: 'bg-zinc-100 text-zinc-950 border-zinc-100',
    estimatorLabel: 'Architectural Estimator',
    estimatorDesc: 'Masonry blocks, plaster, paint, flooring & openings QTO',
  },
  {
    id: 'electrical',
    label: 'Electrical',
    badgeClass: 'bg-zinc-900 border-zinc-700/80 text-zinc-300',
    pillActiveClass: 'bg-zinc-100 text-zinc-950 border-zinc-100',
    estimatorLabel: 'Electrical Estimator',
    estimatorDesc: 'Points, slab & wall conduit drops, wire lengths by gauge',
  },
  {
    id: 'structural',
    label: 'Structural',
    badgeClass: 'bg-zinc-900 border-zinc-700/80 text-zinc-300',
    pillActiveClass: 'bg-zinc-100 text-zinc-950 border-zinc-100',
    estimatorLabel: 'BBS Estimator',
    estimatorDesc: 'Bar bending schedule, cutting lengths & IS 456 steel audit',
  },
  {
    id: 'plumbing',
    label: 'Plumbing',
    badgeClass: 'bg-zinc-900 border-zinc-700/80 text-zinc-300',
    pillActiveClass: 'bg-zinc-100 text-zinc-950 border-zinc-100',
    estimatorLabel: 'Plumbing Estimator',
    estimatorDesc: 'Sanitary fixtures, supply CPVC, drainage SWR & tank sizing',
  },
  {
    id: 'fire',
    label: 'Fire',
    badgeClass: 'bg-zinc-900 border-zinc-700/80 text-zinc-300',
    pillActiveClass: 'bg-zinc-100 text-zinc-950 border-zinc-100',
    estimatorLabel: 'Fire Protection Estimator',
    estimatorDesc: 'Sprinklers, extinguishers, landing valves & riser piping',
  },
];

export interface UploadProgressState {
  pct: number;
  stage: string;
  elapsedSec: number;
  remainingSec: number;
}

export function inferDisciplineFromFilename(...names: (string | undefined | null)[]): PlanDiscipline {
  const s = names.filter(Boolean).join(' ').toLowerCase();
  if (/(?:^|[\s_\-.])(elec\w*|power|lighting|conduit|wiring|panel|switch\w*|sldb|mddb)(?:$|[\s_\-.])/.test(s)) {
    return 'electrical';
  }
  if (/(?:^|[\s_\-.])(struct\w*|column\w*|col|beam\w*|footing\w*|foundation\w*|rcc|slab|khunt|centerline|lintel|plinth)(?:$|[\s_\-.])/.test(s)) {
    return 'structural';
  }
  if (/(?:^|[\s_\-.])(plumb\w*|sanitary|drain\w*|sewer\w*|water|pipe\w*|phe|stp|ugt|oht)(?:$|[\s_\-.])/.test(s)) {
    return 'plumbing';
  }
  if (/(?:^|[\s_\-.])(fire\w*|sprinkler\w*|hydrant\w*|smoke|alarm\w*|hose|fhc)(?:$|[\s_\-.])/.test(s)) {
    return 'fire';
  }
  return 'architectural';
}

export function inferProjectFromFilename(filename: string, existingProjects: string[]): string {
  const stem = filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
  const stopMatch = stem.match(
    /\b(block|working|plan|layout|ground|first|second|third|fourth|1st|2nd|3rd|4th|terrace|typical|floor|sheet|elec\w*|struct\w*|plumb\w*|fire\w*|arch\w*|section\w*|elevation\w*|detail\w*|centerline|column\w*|footing\w*)\b/i
  );
  const prefix = (stopMatch && stopMatch.index !== undefined ? stem.slice(0, stopMatch.index) : stem)
    .replace(/\s+/g, ' ')
    .trim();
  if (!prefix) return '';
  const titled = prefix
    .split(' ')
    .map((w) => (w === w.toUpperCase() && w.length > 1 ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
  const low = titled.toLowerCase();
  for (const p of existingProjects) {
    if (p && p !== 'Default Project') {
      const pl = p.toLowerCase();
      if (pl === low || pl.startsWith(low + ' ') || low.startsWith(pl + ' ')) {
        return p;
      }
    }
  }
  return titled;
}

