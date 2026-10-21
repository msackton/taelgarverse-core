import {createWorker} from './worker-handler.mjs';
import coreRelease from '../.generated/core-release.mjs';
export default createWorker(coreRelease);
