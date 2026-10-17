import { describe, expect, test } from 'bun:test';
import { evaluateWatch } from '../server/watch.ts';

const pipeline = { kind: 'pipeline' as const, label: 'api · main', target_id: 5 };
const job = { kind: 'job' as const, label: 'api · test:unit', target_id: 9 };
const mr = { kind: 'merge_request' as const, label: 'api!3 Fix', target_id: 3 };

describe('evaluateWatch: pipelines and jobs', () => {
  test('running is not done', () => {
    expect(evaluateWatch(pipeline, undefined, { status: 'running' })).toEqual({ events: [], done: false });
  });

  test('terminal states notify once and end the watch', () => {
    expect(evaluateWatch(pipeline, { status: 'running' }, { status: 'success' })).toEqual({
      events: [{ level: 'success', title: 'Pipeline #5 passed', body: 'api · main' }],
      done: true
    });
    expect(evaluateWatch(pipeline, { status: 'running' }, { status: 'failed' }).events[0].level).toBe('failure');
    expect(evaluateWatch(pipeline, undefined, { status: 'manual' }).events[0].title).toBe('Pipeline #5 is waiting for a manual action');
  });

  test('job failure includes the failure reason', () => {
    const r = evaluateWatch(job, { status: 'running' }, { status: 'failed', failureReason: 'runner_system_failure' });
    expect(r.events[0].title).toBe('Job test:unit failed (runner system failure)');
    expect(r.done).toBe(true);
  });
});

describe('evaluateWatch: merge requests', () => {
  test('first observation is a silent baseline', () => {
    expect(evaluateWatch(mr, undefined, { status: 'opened', pipelineId: 1, pipelineStatus: 'failed', conflicts: true })).toEqual({
      events: [],
      done: false
    });
  });

  test('pipeline finishing, new pipeline finishing, and conflicts', () => {
    const base = { status: 'opened', pipelineId: 1, pipelineStatus: 'running', conflicts: false };
    expect(evaluateWatch(mr, base, { ...base, pipelineStatus: 'success' }).events.map((e) => e.title)).toEqual(['MR pipeline passed']);
    expect(evaluateWatch(mr, { ...base, pipelineStatus: 'failed' }, { ...base, pipelineId: 2, pipelineStatus: 'failed' }).events).toHaveLength(1);
    expect(evaluateWatch(mr, { ...base, pipelineStatus: 'failed' }, { ...base, pipelineStatus: 'failed' }).events).toHaveLength(0);
    expect(evaluateWatch(mr, base, { ...base, conflicts: true }).events[0]).toMatchObject({ level: 'failure', title: 'MR has merge conflicts' });
  });

  test('merged or closed ends the watch', () => {
    expect(evaluateWatch(mr, { status: 'opened' }, { status: 'merged' })).toEqual({
      events: [{ level: 'success', title: 'MR merged', body: 'api!3 Fix' }],
      done: true
    });
    expect(evaluateWatch(mr, undefined, { status: 'closed' }).done).toBe(true);
  });
});
