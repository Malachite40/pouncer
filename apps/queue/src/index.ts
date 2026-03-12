import { scraperConcurrencyLimit, workerConcurrency } from './config';
import { worker } from './worker';

console.log(
    `Queue worker started. workerConcurrency=${workerConcurrency} scraperConcurrencyLimit=${scraperConcurrencyLimit}`,
);

export { worker };
