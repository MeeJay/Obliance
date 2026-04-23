import { Router } from 'express';
import { oblireachDesktopVersion, oblireachDesktopDownload } from '../controllers/oblireachDesktop.controller';

// Public routes — no auth. The desktop app polls `version` without
// credentials and the download URL is meant to be opened directly in
// the OS browser.

const router = Router();

router.get('/version', oblireachDesktopVersion);
router.get('/download', oblireachDesktopDownload);

export default router;
