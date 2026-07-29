import { Queue } from 'bullmq';
import connection from './connection.js';

const QUEUE_NAME = 'pr-review-queue';

const reviewQueue = new Queue(QUEUE_NAME, { connection });

async function addReviewJob(jobData) {
  return reviewQueue.add('review-pr', jobData, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: false,
    removeOnFail: false,
  });
}

export { reviewQueue, addReviewJob, QUEUE_NAME };

