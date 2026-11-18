# Hero Stable

An Owlbear Rodeo extension: a stable of heroes. Upload fillable PDF character sheets, fill them in
inside movable/resizable windows, and see everyone's sheets in one list.

- **Sheets list** grouped by player, with search (toolbar popover).
- **Floating windows** you can drag, resize, maximize; several can be open at once.
- **Fill in and save**: PDF.js renders the form fields; edits autosave to your hosted copy.
- **Replace PDF**: swap a sheet's file, optionally carrying over matching filled-in values. One-step undo.
- **Permissions**: everyone in the room can view; the owner, the GM, and players the owner/GM names can edit.

## Develop locally (no accounts needed)

```bash
npm install
npm run dev
```

`npm run dev` uses an on-disk backend in `.localdata/`. Open
`http://localhost:5173/?player=Alice&role=GM&room=test` in a browser tab; the hub and the floating
windows share one page. Use other `player` / `role` values (and `id`) to try other identities.

To load it inside Owlbear Rodeo, add `http://localhost:5173/manifest.json` as a custom extension
(Profile menu → Extensions → Add Custom Extension). Not yet verified inside a real room.

## Deploy (GitHub + Vercel)

1. Push this repo to GitHub and import it in Vercel (framework preset: Vite).
2. In the Vercel project's **Storage** tab, create a **Blob** store with **Public** access and
   connect it to the project (Production, plus Preview if you want). That sets
   `BLOB_READ_WRITE_TOKEN`. It's the only storage needed.
3. Deploy (or redeploy, since variables only reach new deployments). Add
   `https://<your-project>.vercel.app/manifest.json` as the extension URL in Owlbear.

Everything lives in Blob: the PDFs, plus a small versioned JSON record per sheet (name, owner,
editors). Records are immutable files, so simultaneous saves can't overwrite each other. Blob API
calls are metered on free plans, so other players are told about changes by an Owlbear broadcast
instead of constant polling (there is only a slow 60-second safety-net refresh).

## Limits worth knowing

- Owlbear gives extensions no signed identity, so the API trusts the player id/role the extension
  reports. Fine for a friendly table; not hardened against someone deliberately forging requests.
- Uploaded PDFs are stored in a public Vercel Blob store under unguessable URLs.
- Standard AcroForm PDFs only. XFA forms are not supported, and PDFs that rely on JavaScript
  calculations may not recalculate.
