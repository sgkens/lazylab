import { readFileSync, statSync } from 'fs';
import type { Ctx } from './commands.js';
import { CliError } from './client.js';
import { out } from './ui.js';
import type { KnowledgeEntry, KnowledgeSearch } from '../server/bugkb.js';

export function renderKnowledgeEntry(e: KnowledgeEntry) {
  const lines = [`${e.id} [${e.type} | ${e.status}] ${e.title}`, `Project: ${e.project} | Hits: ${e.hits} | Seen in: ${e.seen_in.join(', ')}`];
  for (const [label, text] of [['Symptom', e.symptom], ['Cause', e.cause], ['Fix', e.fix], ['Notes', e.notes]] as const) {
    if (text) lines.push(`${label}: ${text}`);
  }
  lines.push(`Tested environment: ${JSON.stringify(e.env)}`);
  if (Object.keys(e.metrics).length) lines.push(`Measurements: ${JSON.stringify(e.metrics)}`);
  if (e.truncated) lines.push('Some fields were clipped. Read the full entry with lazy kb show <id>.');
  return lines.join('\n');
}

export async function searchKnowledge(ctx: Ctx, input: KnowledgeSearch) {
  if (!input.query.trim()) throw new CliError('Usage: lazy kb search <error text or keywords> [--tag technology] [--type bug|gotcha|perf]', 2);
  const result = await ctx.client.call<{ query: string; entries: KnowledgeEntry[] }>('search_bugkb', { ...input });
  out(ctx.json ? JSON.stringify(result, null, 2) : result.entries.length ? result.entries.map(renderKnowledgeEntry).join('\n\n') : 'No matching findings.');
  return 0;
}

export async function showKnowledge(ctx: Ctx, entryId: string | undefined) {
  if (!entryId) throw new CliError('Usage: lazy kb show <entry-id>', 2);
  const result = await ctx.client.call<KnowledgeEntry>('get_bugkb_entry', { entry_id: entryId });
  out(ctx.json ? JSON.stringify(result, null, 2) : renderKnowledgeEntry(result));
  return 0;
}

export async function recordKnowledge(ctx: Ctx, file: string | undefined) {
  if (!file) throw new CliError('Usage: lazy kb add --file finding.json [--project group/project]', 2);
  let finding: unknown;
  try {
    if (statSync(file).size > 128_000) throw new Error('file exceeds 128 KB');
    finding = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err: any) { throw new CliError(`Cannot read finding JSON: ${err.message}`, 2); }
  const result = await ctx.client.call<KnowledgeEntry>('record_bugkb_finding', { project: ctx.project(), finding });
  out(ctx.json ? JSON.stringify(result, null, 2) : `Recorded shared finding\n${renderKnowledgeEntry(result)}`);
  return 0;
}

export async function confirmKnowledge(ctx: Ctx, entryId: string | undefined, verification: string | undefined) {
  if (!entryId || !verification?.trim()) throw new CliError('Usage: lazy kb confirm <entry-id> --note "checks run and observed results"', 2);
  const result = await ctx.client.call<KnowledgeEntry>('confirm_bugkb_finding', { project: ctx.project(), entry_id: entryId, verification });
  out(ctx.json ? JSON.stringify(result, null, 2) : `Recorded confirmation\n${renderKnowledgeEntry(result)}`);
  return 0;
}
