import { Readable } from "stream";
import express, { Router, type IRouter, type Request, type Response } from "express";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * POST /storage/uploads
 * Admin-only: upload a file through the server directly to object storage.
 * Avoids CORS issues with browser-to-GCS direct uploads.
 */
router.post(
  "/storage/uploads",
  requireAuth,
  requireAdmin,
  express.raw({ type: "*/*", limit: "20mb" }),
  async (req: Request, res: Response) => {
    try {
      const contentType =
        (req.headers["content-type"] as string) || "application/octet-stream";
      const body = req.body as Buffer;
      if (!body || !body.length) {
        res.status(400).json({ error: "Empty body" });
        return;
      }
      const objectPath = await objectStorageService.uploadObjectEntity(
        body,
        contentType,
      );
      res.json({ objectPath });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Upload failed" });
    }
  },
);

/**
 * POST /storage/uploads/request-url
 * Admin-only: generate a presigned GCS upload URL.
 */
router.post(
  "/storage/uploads/request-url",
  requireAuth,
  requireAdmin,
  async (_req: Request, res: Response) => {
    try {
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
      res.json({ uploadURL, objectPath });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Storage error" });
    }
  }
);

/**
 * GET /storage/public-objects/*
 * Unconditionally public — serves assets from PUBLIC_OBJECT_SEARCH_PATHS.
 */
router.get(
  "/storage/public-objects/{*filePath}",
  async (req: Request, res: Response) => {
    const filePath = (req.params as any).filePath as string;
    try {
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const response = await objectStorageService.downloadObject(file);
      const contentType = response.headers.get("content-type") ?? "application/octet-stream";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      if (response.body) {
        Readable.from(response.body as any).pipe(res);
      } else {
        res.end();
      }
    } catch (err: any) {
      if (err instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Not found" });
      } else {
        res.status(500).json({ error: err?.message ?? "Storage error" });
      }
    }
  }
);

/**
 * GET /storage/objects/*
 * Serves private object entities uploaded via presigned URLs.
 * Admin-only for now; open up per-ACL as needed.
 */
router.get(
  "/storage/objects/{*objectKey}",
  async (req: Request, res: Response) => {
    const objectPath = "/objects/" + (req.params as any).objectKey;
    try {
      const file = await objectStorageService.getObjectEntityFile(objectPath);
      const response = await objectStorageService.downloadObject(file, 86400);
      const contentType = response.headers.get("content-type") ?? "application/octet-stream";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400");
      if (response.body) {
        Readable.from(response.body as any).pipe(res);
      } else {
        res.end();
      }
    } catch (err: any) {
      if (err instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Not found" });
      } else {
        res.status(500).json({ error: err?.message ?? "Storage error" });
      }
    }
  }
);

export default router;
