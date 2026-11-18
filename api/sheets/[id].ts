import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handlers, send, toApiReq } from "../_lib/prod.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  send(res, await handlers.sheet(toApiReq(req)));
}
