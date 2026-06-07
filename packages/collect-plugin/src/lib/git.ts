import { type SimpleGit, simpleGit } from 'simple-git';

/**
 * Reads the latest commit SHA and current branch from the local repository.
 *
 * Returns `null` if no commit is found (e.g. a fresh repo with no commits),
 * which lets the caller decide whether to skip persistence or fall back to
 * a default.
 */
export async function detectGitContext(
  git: SimpleGit = simpleGit(),
): Promise<{ sha: string; branch: string } | null> {
  try {
    const log = await git.log({ maxCount: 1 });
    const latest = log.latest;
    if (!latest) {
      return null;
    }
    const branch =
      (await git.revparse(['--abbrev-ref', 'HEAD']).catch(() => ''))?.trim() ||
      'HEAD';
    return { sha: latest.hash, branch };
  } catch {
    return null;
  }
}
