// Reapply reviewed appearance mappings after an import, without modifying any recommendation gates.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function applyStyleEvidence(evidence) {
  const review = JSON.parse(await readFile(new URL('../research/makeup-style-evidence.json', import.meta.url), 'utf8'));
  const allowed = new Set(['chosen_effect', 'format', 'finish', 'chosen_color_family']);
  for (const patch of review.patches) {
    const item = evidence[patch.productId];
    if (!item || item.exactShade !== patch.exactShade) throw new Error(`Style evidence variant changed: ${patch.productId}; re-review before applying.`);
    if (!allowed.has(patch.trait)) throw new Error(`Style evidence cannot change ${patch.trait}.`);
    item.traits[patch.trait] = {
      values: [...patch.values], knownValues: [...patch.values], basis: patch.basis,
      url: patch.url, date: review.reviewedOn, note: patch.note,
    };
  }
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = new URL('../web/data/evidence.json', import.meta.url);
  const evidence = JSON.parse(await readFile(path, 'utf8'));
  await applyStyleEvidence(evidence);
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log('Applied reviewed makeup style traits; all other evidence fields preserved.');
}
