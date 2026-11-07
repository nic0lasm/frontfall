# Clean-room policy

Frontfall is an original game. It belongs to the same family as other browser territory games, and OpenFront in particular inspired it, but it is written from scratch and owes them nothing but the idea. This page explains how we keep it that way. It applies to every contribution, from maintainers included.

## Why it matters

Game mechanics are ideas and can be shared. Code, art, maps, sounds and text are someone's work, protected by copyright and by their own licenses, some of which (such as the AGPL) would bind the whole project if a single file were copied. Frontfall is MIT-licensed, and stays so only if everything in it was written for it or comes from a compatible source.

## The rules

1. **Implement from the specification.** Gameplay work starts from [rules.md](rules.md) and [balance.md](balance.md). If the specification is missing something, propose a rule in an issue first.
2. **Do not read other games' source code while working on Frontfall.** Playing them, reading their public wiki or watching videos of them is fine: that is how players learn mechanics. Opening their repository to see how something is done is not.
3. **Copy nothing.** No code, shader, map, image, icon, sound, font, translation or text from another game, even a short snippet, even rewritten line by line.
4. **Use only compatible third-party material.** Assets and data must be in the public domain, CC0, or under a license compatible with MIT (MIT, BSD, Apache 2.0, ISC, OFL for fonts). Each one is listed in [CREDITS.md](../CREDITS.md) with its source and license, in the same pull request that adds it.
5. **Maps come from open geographic data.** World and region maps are generated from public-domain sources such as Natural Earth, by scripts in this repository, so anyone can regenerate them.
6. **Use our own names and numbers.** Units, structures and balance values are named and tuned for Frontfall.

## How it is checked

- The pull request template asks each contributor to confirm that the change contains nothing copied from another game.
- The **Clean room** CI job compares every pull request with the source of OpenFront, the game closest to ours. It fetches that codebase at the start of the job, outside the workspace, and deletes it at the end: it is never committed, cached or built into an image.
  - Code is compared as runs of tokens, so reformatting the code or removing its comments does not hide a copy. A run of 60 tokens or more found in both codebases fails the job and is reported on the lines concerned.
  - Every other file is compared by content hash, which catches copied images, maps and data files.
- Run it locally with a checkout of the reference codebase:

  ```sh
  git clone --depth 1 https://github.com/openfrontio/OpenFrontIO.git /tmp/reference
  bun run clean-room --reference /tmp/reference --base origin/main
  rm -rf /tmp/reference
  ```

  The job prints only locations in Frontfall, never the reference code.

## When the check fails

A match is not an accusation: two people can write the same short idiom. Look at the reported lines. If they are generic (for example, a standard algorithm written the common way), say so in the pull request and a maintainer will review it. If they were copied, remove them and rewrite the feature from the specification, without looking at the original again.

Questions about whether something is acceptable go to [Discussions](https://github.com/nic0lasm/frontfall/discussions) before the code is written.
