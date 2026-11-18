import { issueSignedToken } from "@vercel/blob";
import { handleUploadPresigned, type HandleUploadPresignedBody } from "@vercel/blob/client";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const MAX_BYTES = 15 * 1024 * 1024;

/**
 * Lets browsers upload PDFs straight to Vercel Blob (past Vercel's 4.5 MB request limit).
 * Uses presigned URLs, which work with the store's own credentials (BLOB_STORE_ID + OIDC), so
 * no BLOB_READ_WRITE_TOKEN is needed.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const json = await handleUploadPresigned({
      body: req.body as HandleUploadPresignedBody,
      request: req,
      getSignedToken: async (pathname, clientPayload) => {
        const who = JSON.parse(clientPayload ?? "{}") as { roomId?: string; playerId?: string };
        if (!who.roomId || !who.playerId) throw new Error("Missing player identity");
        const token = await issueSignedToken({
          pathname,
          operations: ["put"],
          allowedContentTypes: ["application/pdf"],
          maximumSizeInBytes: MAX_BYTES,
        });
        return { token, urlOptions: { addRandomSuffix: true } };
      },
    });
    res.status(200).json(json);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
}
