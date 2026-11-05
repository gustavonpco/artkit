// A worker that accepts batches and never answers: used to test the pool's time limit and worker replacement.
import { parentPort } from 'node:worker_threads';

parentPort.on('message', () => {});
