import { AsyncLocalStorage } from 'async_hooks';

export interface AggregateRead {
  /** The list is bounded to recent projects, not a complete account inventory. */
  limit: number;
  attempted: number;
  loaded: number;
  errors: { projectId: number; projectName: string; message: string }[];
}

const reads = new AsyncLocalStorage<{ coverage?: AggregateRead }>();

/** Reports only into the caller's request context; concurrent views cannot overwrite each other. */
export function reportAggregateRead(coverage: AggregateRead): void {
  const current = reads.getStore();
  if (current) current.coverage = coverage;
}

/** Keep the client's array API for internal callers while HTTP envelopes expose partial reads. */
export async function captureAggregateRead<T>(load: () => Promise<T>): Promise<{ data: T; coverage?: Omit<AggregateRead, 'errors'>; errors: AggregateRead['errors'] }> {
  const context: { coverage?: AggregateRead } = {};
  return reads.run(context, async () => {
    const data = await load();
    if (!context.coverage) return { data, errors: [] };
    const { errors, ...coverage } = context.coverage;
    return { data, coverage, errors };
  });
}
