import { Router, type IRouter } from "express";
import healthRouter from "./health";
import gameRouter from "./game";
import accountRouter from "./account";
import notificationsRouter from "./notifications";
import adminRouter, { reportRouter, announcementsPublicRouter } from "./admin";
import analyticsRouter from "./analytics";

const router: IRouter = Router();

router.use(healthRouter);
router.use(gameRouter);
router.use(accountRouter);
router.use(notificationsRouter);
router.use(adminRouter);
router.use(reportRouter);
router.use(announcementsPublicRouter);
router.use(analyticsRouter);

export default router;
