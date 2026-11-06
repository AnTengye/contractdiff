import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
const filename = process.argv[2];
if (!filename) {
  console.error('Usage: npm run replay:feedback -- /path/to/feedback-case.json');
  process.exit(2);
}
const fixture = JSON.parse(await readFile(filename, 'utf8'));
if (fixture.schema_version !== 'regression-v1') throw new Error('Unsupported regression schema');
const output = await build({
  entryPoints: ['src/services/diff/textv2/engine.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { computeTextDiffV2 } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].contents).toString('base64')}`
);
const documents = fixture.snapshot.documents;
const expected = fixture.expectation;
let result;
if (documents.left?.data && documents.right?.data)
  result = computeTextDiffV2(
    documents.left.data,
    documents.right.data,
    fixture.snapshot.comparison?.metadata?.options ?? {}
  );
if (
  expected.total_changes !== undefined &&
  (!result || result.stats.totalChanges !== expected.total_changes)
)
  throw new Error('Difference count does not match the labeled expectation');
for (const side of ['left', 'right']) {
  const text = expected[`${side}_text`];
  if (!text) continue;
  const extracted =
    result?.[side].fullText ??
    (
      await import(
        `data:text/javascript;base64,${Buffer.from((await build({ entryPoints: ['src/services/diff/textv2/textExtractor.ts'], bundle: true, platform: 'node', format: 'esm', write: false })).outputFiles[0].contents).toString('base64')}`
      )
    ).extractText(documents[side]?.data ?? {}).fullText;
  if (!extracted.includes(text))
    throw new Error(`${side} text does not match the labeled expectation`);
}
console.log(`Feedback case ${fixture.case.id}: regression passed`);
