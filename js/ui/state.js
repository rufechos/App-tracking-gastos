// What the screens are showing right now (not saved).
import { defaultPeriod } from '../period.js';

export const ui = {
  tab: 'inicio',
  period: defaultPeriod(),
  periodOpen: false,
  mvLimit: 50,
  pending: null, // the "learn this name" prompt under a movement you just changed
  q: '', fCat: '', fAcct: '',
  syncing: false,
  bankMsg: '',
  invMsg: '',
  aspsps: [],
  features: null, // what your server supports (/ping)
  serverVersion: null,
  update: null, // a waiting service worker with a new version
  restore: null, // a backup file being restored, waiting for confirmation
  claimTimer: null,
};
