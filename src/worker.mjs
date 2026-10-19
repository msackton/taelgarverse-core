import {instantiate,headerRevision} from '../.generated/headers.mjs';
import {createWorker} from './worker-handler.mjs';
export default createWorker(instantiate,headerRevision);
