import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const MAX_BYTES = 15 * 1024 * 1024;

/** Issues short-lived tokens so browsers upload PDFs straight to Vercel Blob. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const json = await handleUpload({
      body: req.body as HandleUploadBody,
      request: req,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        const who = JSON.parse(clientPayload ?? "{}") as { roomId?: string; playerId?: string };
        if (!who.roomId || !who.playerId) throw new Error("Missing player identity");
        return {
          allowedContentTypes: ["application/pdf"],
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: true,
        };
      },
      // The client registers the file with /api/sheets after the upload, so nothing to do here.
      onUploadCompleted: async () => {},
    });
    res.status(200).json(json);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
}
