// The Markdown that fixture-content.astro stands in for. The tests read the FAQ out of this text
// (the way the registry reads it out of a tool's content/en.mdx) and compare it with the page.

export const FIXTURE_MDX = `An intro paragraph.

## How to use

Words.

## Examples

Words.

## Limits

Words.

## FAQ

### Is my text uploaded?

No. It runs in your **browser**, so [nothing is uploaded](/privacy/).

### Does it count characters?

Yes. It counts \`characters\` with and without spaces, and it also counts lines.
`;
