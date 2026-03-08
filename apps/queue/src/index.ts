import './config';
import { worker } from './worker';

console.log('Queue worker started. Waiting for jobs...');

export { worker };
