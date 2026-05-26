import { CloudTasksClient, protos } from '@google-cloud/tasks';

import type { Env } from '@/config/env.js';

export interface EnqueueTaskInput {
  queue: string;
  url: string;
  payload: unknown;
  scheduleAt?: Date;
  oidcAudience?: string;
}

export interface TasksHandles {
  client: CloudTasksClient;
  enqueue(input: EnqueueTaskInput): Promise<string>;
  queuePath(queue: string): string;
}

export function initTasks(env: Env): TasksHandles {
  const client = new CloudTasksClient();

  const queuePath = (queue: string): string =>
    client.queuePath(env.GCP_PROJECT_ID, env.GCP_REGION, queue);

  return {
    client,
    queuePath,
    async enqueue(input) {
      const parent = queuePath(input.queue);
      const task: protos.google.cloud.tasks.v2.ITask = {
        httpRequest: {
          httpMethod: 'POST',
          url: input.url,
          headers: { 'content-type': 'application/json' },
          body: Buffer.from(JSON.stringify(input.payload)).toString('base64'),
          ...(input.oidcAudience
            ? { oidcToken: { audience: input.oidcAudience, serviceAccountEmail: '' } }
            : {}),
        },
        ...(input.scheduleAt
          ? {
              scheduleTime: {
                seconds: Math.floor(input.scheduleAt.getTime() / 1000),
              },
            }
          : {}),
      };
      const [response] = await client.createTask({ parent, task });
      if (!response.name) {
        throw new Error('Cloud Tasks createTask returned no task name');
      }
      return response.name;
    },
  };
}
