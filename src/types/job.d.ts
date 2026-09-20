import type { Processor, Queue } from "bullmq";

interface JobItem {
  name: string;
  queue: Queue;
  schedule?: string;
  processor?: string | URL | Processor<any, any, string> | null | undefined;
  concurrency?: number;
  options?: WorkerOptions;
}
