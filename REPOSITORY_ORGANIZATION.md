# Repository Organization Record

**Recorded:** September 11, 2026
**Projects:** `DI_Bootcamp` and `ConvoLens`

## Purpose

This note records how ConvoLens was separated from the larger Bootcamp repository and explains the resulting organization. It is intended to preserve the current state for future work and provide a concrete example from which a learner or AI can infer principles of clean repository design.

## Starting situation

ConvoLens initially existed inside the root of the existing `DI_Bootcamp` repository. Two ConvoLens files had been created there:

```text
DI_Bootcamp/
├── index.html       # Temporarily replaced by the ConvoLens page
└── src/
    └── main.ts      # ConvoLens types and sample data
```

This mixed a standalone portfolio project with Bootcamp exercises. It also temporarily replaced an existing Bootcamp exercise in the repository's root `index.html`.

## Organizational changes completed

1. A separate project folder was created at:

   ```text
   /Users/Rome/Documents/Repositories/ConvoLens
   ```

2. The ConvoLens `index.html` and `src/main.ts` files were moved from `DI_Bootcamp` into that folder without changing their application code.

3. The original root `index.html` exercise was restored in `DI_Bootcamp`.

4. The now-empty `DI_Bootcamp/src` directory was removed. No unrelated Bootcamp files were deleted or reorganized.

5. A `README.md` was added to ConvoLens. It identifies the project, documents its current capabilities and limitations, shows its structure, and lists logical next steps.

6. A `.gitignore` was added to ConvoLens. It excludes installed dependencies, generated output, environment files, macOS metadata, and log files from version control.

7. Git was initialized inside `ConvoLens`, using `main` as the initial branch.

## Current ConvoLens structure

```text
ConvoLens/
├── .git/                         # Local Git history and repository metadata
├── .gitignore                    # Files Git should intentionally ignore
├── README.md                     # Project overview and setup status
├── REPOSITORY_ORGANIZATION.md    # This organizational record
├── index.html                    # Minimal page structure
└── src/
    └── main.ts                   # Type definitions and sample conversation data
```

The application currently contains:

- A page title and headings for ConvoLens and its transcript.
- An empty `<div id="transcript">` that will later receive rendered transcript content.
- A module reference from `index.html` to `/src/main.ts`.
- `TranscriptSegment` and `Conversation` TypeScript types.
- One sample conversation with two speakers and two transcript segments.

There is deliberately no DOM rendering loop yet. Vite or equivalent development tooling has also not been configured, so the TypeScript entry point is not ready to run merely by opening `index.html` directly.

## Current Git state

ConvoLens is a local Git repository with the branch name `main`, but it has no commits yet. Its project files are therefore currently untracked by Git.

```text
Branch: main
First commit: not created
GitHub repository: not created or connected
Remote: not configured
```

Initializing Git and publishing to GitHub are separate actions:

- **Git initialization** gives the local folder version-control capabilities.
- **A commit** records a local snapshot of the files.
- **A GitHub repository and remote** provide an online destination.
- **A push** uploads committed history to that destination.

## Relationship to the Bootcamp repository

The repositories now have separate responsibilities:

```text
Repositories/
├── DI_Bootcamp/    # Course lessons, exercises, and shared Bootcamp tooling
└── ConvoLens/      # Standalone application and portfolio project
```

`DI_Bootcamp` still contains its own `package.json`, `package-lock.json`, and `node_modules` directory. Its `node_modules` directory is approximately 28 MB and contains tools used for TypeScript exercises, including TypeScript, `ts-node`, and Node.js type definitions.

That dependency folder was left in place because it still belongs to the Bootcamp setup. It is ignored by Git and is not tracked, so it will not be uploaded to GitHub. If deleted to save local disk space, it can be recreated from the package files with `npm install`.

ConvoLens does not currently have its own `package.json`, `package-lock.json`, or `node_modules`. Those should be created in ConvoLens when its development tooling is configured. Dependencies should belong to the repository that uses them rather than being shared implicitly from a neighboring repository.

## What this organization demonstrates

### One repository, one coherent project

A focused repository gives ConvoLens its own name, history, documentation, dependencies, issue tracking, and GitHub presentation. Visitors can understand the project without navigating unrelated coursework.

### Source files and generated files have different roles

Files such as `index.html`, `src/main.ts`, and `README.md` express the project and belong in version control. Re-creatable or sensitive files such as `node_modules`, `dist`, `.env`, and logs are excluded through `.gitignore`.

### Each repository owns its dependencies

When ConvoLens receives a package configuration, its dependency declarations and local installation will live inside `ConvoLens`. The Bootcamp repository retains the dependencies used by Bootcamp exercises. This makes each project reproducible and prevents hidden coupling between neighboring folders.

### Documentation should distinguish reality from plans

The ConvoLens README describes both implemented work and future work. It does not present planned transcription, AI analysis, audio upload, or backend functionality as if those features already exist.

### Git stages are explicit

A folder becoming a Git repository does not automatically create a commit, publish anything, or connect it to GitHub. Those are separate, reviewable stages.

### Unrelated work should be preserved

The migration changed only files known to belong to ConvoLens and restored the Bootcamp file that had been temporarily replaced. Other Bootcamp changes, including unrelated untracked work, were left untouched.

## Sensible next organizational steps

1. Configure Vite and TypeScript inside ConvoLens. This will create a ConvoLens-specific `package.json`, lockfile, and local `node_modules` directory.
2. Verify that the development server works and that the current page loads.
3. Review the repository contents, then create the first Git commit.
4. Create a matching GitHub repository, connect it as a remote, and push the `main` branch.
5. Update the README as real functionality is added so the repository remains an accurate portfolio record.

## Compact mental model

```text
project source + documentation + dependency declarations
                         │
                         ├── committed to Git
                         │
                         └── enough information to recreate
                             ignored dependencies and build output
```

A clean repository is not merely a tidy folder. It is a project whose purpose, source, dependencies, current capabilities, and history can be understood and reproduced without relying on undocumented files elsewhere on the computer.
