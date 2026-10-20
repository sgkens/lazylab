/** Task briefings and resumable checkpoints use the same MCP tools as connected agents. */
import { readFileSync, statSync } from 'fs';
import type { Ctx } from './commands.js';
import { CliError } from './client.js';
import { out } from './ui.js';
import type { AgentHandoff, TaskKind } from '../server/handoffs.js';

export function parseTask(kind: string | undefined, iid: string | undefined): { kind: TaskKind; iid: number } {
  if (kind !== 'issue' && kind !== 'mr') throw new CliError('Task must be issue <iid> or mr <iid>', 2);
  const n = Number(iid?.replace(/^[#!]/, ''));
  if (!Number.isSafeInteger(n) || n <= 0) throw new CliError('Task iid must be a positive integer', 2);
  return { kind: kind === 'issue' ? 'work_item' : 'merge_request', iid: n };
}

export function renderHandoff(h: AgentHandoff): string {
  const lines = [`### ${h.status} — ${h.created_at}`, `Agent: ${h.author.name}`, h.summary];
  if (h.branch) lines.push(`Branch: ${h.branch}`);
  if (h.head_sha) lines.push(`Commit: ${h.head_sha}`);
  for (const [label, values] of [['Decisions', h.decisions], ['Attempts', h.attempts], ['Blockers', h.blockers], ['Next steps', h.next_steps]] as const) {
    if (values.length) lines.push(`\n${label}:`, ...values.map((v) => `- ${v}`));
  }
  if (h.verification.length) lines.push('\nVerification (agent reported):', ...h.verification.map((v) => `- ${v.result}: ${v.check}${v.details ? ` — ${v.details}` : ''}`));
  return lines.join('\n');
}

export function renderBriefing(b: any): string {
  const t = b.task;
  const lines = [`# ${t.kind === 'work_item' ? '#' : '!'}${t.iid} ${t.title}`, t.web_url, `State: ${t.state} | Generated: ${b.generated_at}`, '', t.description];
  if (b.demo) lines.push('\nDemo data: this is a sample task.');
  lines.push('\n## Acceptance criteria', ...(b.acceptance_criteria.length ? b.acceptance_criteria.map((c: any) => `- [${c.completed ? 'x' : ' '}] ${c.text}`) : ['No explicit acceptance checklist found.']));
  lines.push('\n## Recent discussion');
  for (const n of b.comments ?? []) lines.push(`\n${n.author} (${n.created_at}):\n${n.body}`);
  for (const mr of b.merge_requests) {
    lines.push(`\n## MR !${mr.iid}: ${mr.title}`, mr.web_url, `${mr.source_branch} → ${mr.target_branch}`, `Head: ${mr.head_sha ?? 'unknown'} | Pipeline: ${mr.pipeline?.status ?? 'none'}`);
    if (t.kind === 'work_item') lines.push(mr.description);
    for (const d of mr.diffs ?? []) lines.push(`\nFile: ${d.new_path}${d.collapsed || d.too_large ? ' (patch unavailable)' : ''}\n${d.diff}`);
    for (const f of mr.failures ?? []) lines.push(`\nFailed job: ${f.job}`, f.error_line, f.log);
  }
  lines.push('\n## Handoffs (agent reported)');
  for (const h of b.handoffs) {
    lines.push(renderHandoff(h));
    if (h.matches_head === false) lines.push('MR head has changed since this handoff.');
    else if (h.matches_head === null) lines.push('Handoff freshness is unknown.');
  }
  if (!b.handoffs.length) lines.push('No saved handoffs.');
  if (b.knowledge) {
    lines.push(`\n## Shared findings (BugKB: ${b.knowledge.status})`);
    for (const e of b.knowledge.entries) lines.push(`\n${e.id} [${e.type} | ${e.status}] ${e.title}`,
      `Tested environment: ${JSON.stringify(e.env)}`, `Symptom: ${e.symptom}`, `Fix: ${e.fix}`,
      ...(e.verification ? [`Recorded verification: ${e.verification}`] : []),
      ...(e.notes ? [`Confirmation notes: ${e.notes}`] : []),
      ...(e.truncated ? ['Entry clipped; read it with lazy kb show before applying the fix.'] : []));
    if (b.knowledge.status === 'available' && !b.knowledge.entries.length) lines.push('No matching findings.');
  }
  if (b.errors.length) lines.push('\n## Unavailable sources', ...b.errors.map((e: any) => `- ${e.source}: ${e.message}`));
  if (b.omissions.length) lines.push('\n## Limits', ...b.omissions.map((s: string) => `- ${s}`));
  lines.push(`\n${b.guidance}`);
  return lines.join('\n');
}

export async function brief(ctx: Ctx, task: { kind: TaskKind; iid: number }) {
  const data = await ctx.client.call('get_task_briefing', { project: ctx.project(), ...task });
  out(ctx.json ? JSON.stringify(data, null, 2) : renderBriefing(data));
  return 0;
}

export async function handoffList(ctx: Ctx, task: { kind: TaskKind; iid: number }, limit = 5) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new CliError('--limit must be between 1 and 20', 2);
  const data = await ctx.client.call<AgentHandoff[]>('list_handoffs', { project: ctx.project(), ...task, limit });
  out(ctx.json ? JSON.stringify(data, null, 2) : data.length ? data.map(renderHandoff).join('\n\n') : 'No saved handoffs.');
  return 0;
}

export async function handoffSave(ctx: Ctx, task: { kind: TaskKind; iid: number }, file: string | undefined) {
  if (!file) throw new CliError('Usage: lazy handoff save issue|mr <iid> --file <handoff.json>', 2);
  let handoff: unknown;
  try {
    if (statSync(file).size > 128_000) throw new Error('file exceeds 128 KB');
    handoff = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err: any) { throw new CliError(`Cannot read handoff JSON: ${err.message}`, 2); }
  const data = await ctx.client.call<AgentHandoff>('save_handoff', { project: ctx.project(), ...task, handoff });
  out(ctx.json ? JSON.stringify(data, null, 2) : `Saved handoff ${data.id}\n${renderHandoff(data)}`);
  return 0;
}
