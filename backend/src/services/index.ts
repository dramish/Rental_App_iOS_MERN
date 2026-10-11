import { makeTestServices } from './defaults';
import type { Services } from './types';

let current: Services = makeTestServices();

/** Service locator. server.ts installs real implementations; tests install recording ones. */
export const services = (): Services => current;
export const setServices = (s: Services): void => {
  current = s;
};
