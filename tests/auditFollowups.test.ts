import { beforeAll, describe, expect, test } from 'bun:test';
import { GitLabClient } from '../server/gitlabClient.ts';
import { cacheDb } from '../server/cacheDb.ts';
import { redactVariable } from '../server/variables.ts';

beforeAll(async () => {
  await cacheDb.init();
});

// Nothing listens on port 9: every request fails at the network layer, like an unreachable GitLab.
const unreachable = () => new GitLabClient('http://127.0.0.1:9', 'glpat-test');

describe('list reads report GitLab failures', () => {
  test('per-project lists reject instead of returning []', async () => {
    const client = unreachable();
    await expect(client.getPipelines(1, true)).rejects.toThrow();
    await expect(client.getWorkItems(1, 'all', true)).rejects.toThrow();
    await expect(client.getMergeRequests(1, 'all', true)).rejects.toThrow();
    await expect(client.getTags(1, true)).rejects.toThrow();
    await expect(client.getVariables('project', 1)).rejects.toThrow();
    await expect(client.getBadges('project', 1)).rejects.toThrow();
    await expect(client.getWorkItemNotes(1, 1)).rejects.toThrow();
  });

  test('a job log that cannot be read rejects instead of a placeholder trace', async () => {
    await expect(unreachable().getJobTrace(1, 1)).rejects.toThrow();
  });
});

describe('redactVariable', () => {
  test('drops masked values and marks them hidden', () => {
    const masked = redactVariable({ key: 'TOKEN', value: 's3cret', masked: true });
    expect(masked.value).toBe('');
    expect(masked.value_hidden).toBe(true);
    const plain = redactVariable({ key: 'REGION', value: 'eu-west-1', masked: false });
    expect(plain.value).toBe('eu-west-1');
    expect(plain.value_hidden).toBeUndefined();
  });
});

describe('subtasks return the updated work item', () => {
  const demo = new GitLabClient();

  test('toggle returns the item with the new state', async () => {
    const [item] = (await demo.getWorkItems()).filter((i) => (i.subtasks?.length ?? 0) > 0);
    // Demo items are shared objects, so read the starting state before toggling.
    const { id, completed } = item.subtasks![0];
    const updated = await demo.toggleSubTask(item.project_id, item.iid, id, !completed);
    expect(updated.iid).toBe(item.iid);
    expect(updated.subtasks!.find((s) => s.id === id)!.completed).toBe(!completed);
    await demo.toggleSubTask(item.project_id, item.iid, id, completed);
  });

  test('toggle of an unknown subtask rejects', async () => {
    const [item] = await demo.getWorkItems();
    await expect(demo.toggleSubTask(item.project_id, item.iid, 987654, true)).rejects.toThrow('not found');
  });

  test('add returns the subtask and the item that holds it', async () => {
    const [item] = await demo.getWorkItems();
    const { subtask, workItem } = await demo.addSubTask(item.project_id, item.iid, 'write the test');
    expect(workItem.subtasks!.some((s) => s.id === subtask.id)).toBe(true);
  });

  test('variables can be read one at a time with their value', async () => {
    const [v] = await demo.getVariables('project', 1);
    if (!v) return;
    const one = await demo.getVariable('project', v.scope_id, v.key, v.environment_scope);
    expect(one.value).toBe(v.value);
  });
});
