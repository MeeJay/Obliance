import { Router } from 'express';
import { androidVersion, androidDownload } from '../controllers/mobileApp.controller';

// Public routes — no auth (contract: docs/obli-mobile.md §6).
// The Android shell polls `version` before/without a web session and its
// updater downloads the APK with DownloadManager. Mounted at /api/mobile and
// skipped by apiLimiter (middleware/rateLimiter.ts).
//
// Future authenticated mobile routes (e.g. push subscriptions) must be
// mounted separately with requireAuth, never added to this public router.

const router = Router();

router.get('/android/version', androidVersion);
router.get('/android/download', androidDownload);

export default router;
