import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
} from "pdf-lib";

const load = (bytes: Uint8Array) =>
  PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });

/** Names of the AcroForm fields in a PDF (empty when it isn't fillable). */
export async function listFieldNames(bytes: Uint8Array): Promise<string[]> {
  const doc = await load(bytes);
  return doc
    .getForm()
    .getFields()
    .map((f) => f.getName());
}

export interface CarryOverResult {
  /** The new PDF with matching values copied in. */
  bytes: Uint8Array;
  copied: number;
  /** Field names in the old PDF that don't exist (or changed type) in the new one. */
  missing: string[];
  /** Field names that only exist in the new PDF. */
  added: string[];
}

/** Copy filled-in values from `oldBytes` into `newBytes` for fields with the same name and type. */
export async function carryOver(oldBytes: Uint8Array, newBytes: Uint8Array): Promise<CarryOverResult> {
  const [oldDoc, newDoc] = await Promise.all([load(oldBytes), load(newBytes)]);
  const oldForm = oldDoc.getForm();
  const newForm = newDoc.getForm();
  const newNames = new Set(newForm.getFields().map((f) => f.getName()));
  const oldNames = new Set(oldForm.getFields().map((f) => f.getName()));

  let copied = 0;
  const missing: string[] = [];

  for (const oldField of oldForm.getFields()) {
    const name = oldField.getName();
    const target = newNames.has(name) ? newForm.getFieldMaybe(name) : undefined;
    if (!target) {
      missing.push(name);
      continue;
    }
    try {
      if (oldField instanceof PDFTextField && target instanceof PDFTextField) {
        const text = oldField.getText();
        if (text) target.setText(text);
        else continue;
      } else if (oldField instanceof PDFCheckBox && target instanceof PDFCheckBox) {
        if (oldField.isChecked()) target.check();
        else continue;
      } else if (oldField instanceof PDFDropdown && target instanceof PDFDropdown) {
        const picked = oldField.getSelected();
        if (picked.length === 0) continue;
        target.select(picked);
      } else if (oldField instanceof PDFOptionList && target instanceof PDFOptionList) {
        const picked = oldField.getSelected();
        if (picked.length === 0) continue;
        target.select(picked);
      } else if (oldField instanceof PDFRadioGroup && target instanceof PDFRadioGroup) {
        const picked = oldField.getSelected();
        if (!picked) continue;
        target.select(picked);
      } else {
        missing.push(name); // same name, different kind of field
        continue;
      }
      copied++;
    } catch {
      // e.g. a dropdown choice that doesn't exist in the new sheet, or a character the font can't draw
      missing.push(name);
    }
  }

  try {
    newForm.updateFieldAppearances();
  } catch {
    /* the viewer redraws fields anyway */
  }

  const added = [...newNames].filter((n) => !oldNames.has(n));
  return { bytes: await newDoc.save(), copied, missing, added };
}
