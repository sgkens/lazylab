import { describe, expect, test } from 'bun:test';
import { captureAggregateRead } from '../server/aggregateReads.ts';
import { GitLabClient, type GitLabProject } from '../server/gitlabClient.ts';

function clientWithLabels(count: number, failed: number[] = [], delay = 0) {
  const client = new GitLabClient('https://gitlab.test', 'test-token');
  const attempted: number[] = [];
  client.getProjects = async () => Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `repo-${i + 1}`, path_with_namespace: `team/repo-${i + 1}` } as GitLabProject));
  client.getLabels = async (projectId, force) => {
    if (!projectId) return GitLabClient.prototype.getLabels.call(client, projectId, force);
    attempted.push(projectId);
    if (delay) await Bun.sleep(delay);
    if (failed.includes(projectId)) throw new Error('GitLab unavailable');
    return [{ id: projectId, name: `label-${projectId}`, color: '#ff0000', description: '' }];
  };
  return { client, attempted };
}

describe('bounded aggregate read coverage', () => {
  test('returns successful rows together with per-project failures', async () => {
    const { client } = clientWithLabels(3, [2]);
    const response = await captureAggregateRead(() => client.getLabels());
    expect(response.data.map((row) => row.name)).toEqual(['label-1', 'label-3']);
    expect(response.coverage).toEqual({ limit: 15, attempted: 3, loaded: 2 });
    expect(response.errors).toEqual([{ projectId: 2, projectName: 'team/repo-2', message: 'GitLab unavailable' }]);
  });

  test('does not contact projects outside the recent-project budget', async () => {
    const { client, attempted } = clientWithLabels(30);
    const response = await captureAggregateRead(() => client.getLabels());
    expect(response.coverage).toEqual({ limit: 15, attempted: 15, loaded: 15 });
    expect(response.errors).toEqual([]);
    expect(attempted).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  });

  test('an empty project list has zero attempted reads and no errors', async () => {
    const { client } = clientWithLabels(0);
    expect(await captureAggregateRead(() => client.getLabels())).toEqual({ data: [], coverage: { limit: 15, attempted: 0, loaded: 0 }, errors: [] });
  });

  test('all-project failures remain errors, not an apparently empty successful list', async () => {
    const { client } = clientWithLabels(2, [1, 2]);
    await expect(captureAggregateRead(() => client.getLabels())).rejects.toThrow('GitLab unavailable');
  });

  test('single-project lists do not claim aggregate coverage', async () => {
    const { client } = clientWithLabels(2);
    const response = await captureAggregateRead(() => client.getLabels(1));
    expect(response.coverage).toBeUndefined();
    expect(response.errors).toEqual([]);
  });

  test('concurrent requests retain their own coverage and failure details', async () => {
    const a = clientWithLabels(3, [2], 5).client;
    const b = clientWithLabels(1, [], 10).client;
    const [first, second] = await Promise.all([
      captureAggregateRead(() => a.getLabels()),
      captureAggregateRead(() => b.getLabels()),
    ]);
    expect(first.coverage?.loaded).toBe(2);
    expect(first.errors[0]?.projectId).toBe(2);
    expect(second.coverage?.loaded).toBe(1);
    expect(second.errors).toEqual([]);
  });
});
