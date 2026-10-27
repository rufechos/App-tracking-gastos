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
  cron: null, // when your server last looked at your banks for notifications (/ping)
  update: null, // a waiting service worker with a new version
  restore: null, // a backup file being restored, waiting for confirmation
  claimTimer: null,
  anCat: null, // the category whose evolution Análisis shows
  worthEdit: null, // the account whose balance you are typing
  scrollTo: null, // a section to bring into view after the next drawing
  lockCode: null, // the recovery code just made, shown until you say you saved it
  vault: { has: null, mode: null, busy: '', msg: '', blob: null }, // the encrypted copy: key on this device?, form shown, the copy being opened
};
