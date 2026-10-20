# Worktrees

Every manager works in its own git worktree, on its own branch. Two managers
running at once never edit the same files, and the main checkout is never touched
by a task. What a worktree needs before work can start (a database, an `.env`,
installed dependencies) differs from project to project, so the project says so in
one file.

## What happens

1. The CEO launches a manager for a task.
2. The manager's first action is to create a worktree and move its session into it
   (OpenCode's `worktree_create` and `session_move`). It names the worktree after
   the task, for example `fix-login`. The branch is `work/fix-login`.
3. The manager launches `workers/setup`. That worker puts the worktree on the
   branch, reads the project's guidance file, follows it, checks each step, and
   reports `READY`, `PARTIAL` or `FAILED`.
4. On `READY` the manager launches its workers. They start in the worktree, because
   a launched worker inherits its parent's directory. Anything but `READY` halts
   the manager, with the setup report passed up.
5. When the task ends the worktree stays where it is. The report gives its
   directory and branch. Nothing is merged, pushed or removed for you; the manager
   has no tool for removing a worktree.

If the project is not a git repository the worktree cannot be created. The manager
says so and works in place instead.

## Telling a project how to set up

Create `.opencode/worktree-setup.md` in the project and **commit it**. A worktree
holds only committed files, so an uncommitted guidance file is not there; the setup
worker also looks in the main checkout when the manager passes its path, but do not
rely on that.

Write it as you would explain it to a new colleague. Steps in words, a script to
run, or both. Say how to check each step worked. Use the worktree name wherever
something must be unique per worktree, because several exist at once. The worker is
given the name.

```md
# Worktree setup

1. Create a database named `app_<worktree name>` from `db/template.sql`
   with `./scripts/create-db.sh app_<worktree name>`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` to that database.
3. Run `pnpm install`.
4. Check: `./scripts/create-db.sh --check app_<worktree name>` exits 0, and
   `.env` has the new `DATABASE_URL`.

If the database already exists, use `app_<worktree name>_2`.
```

With no file, setup is the plain fallback: a git worktree on a new branch, nothing
else.

### What the setup worker may do

- It can read, search, edit and run commands in the worktree. It may edit `.env`
  files, since setup often needs to, and it never writes a secret value into its
  report.
- If a step fails it may fix an ordinary cause (a missing directory, a taken name or
  port, a dependency to install) and retry, at most twice per step.
- It will not drop, truncate or overwrite anything it did not create in that run,
  will not touch the main checkout, and cannot push, add remotes or use `sudo`. If
  the only way forward needs one of those, it stops and reports.

## Requirements and limits

- **The team must be committed in the project.** After the move, OpenCode loads
  agents and config from the worktree, so `.opencode/agents/` and `opencode.json`
  (with the raised `experimental.subagent_depth`) must be committed, or the team
  installed globally. Checked: an agent file that was not committed gave
  `Agent not found` the moment the session moved into the worktree.
- **Where worktrees live.** By default in OpenCode's data directory. To put them
  elsewhere, set `worktree.directory` in `opencode.json`, for example
  `"worktree": { "directory": "../worktrees" }`.
- **A worktree starts detached.** OpenCode creates it without a branch; the setup
  worker creates `work/<name>`. Work is lost if that step is skipped, which is why a
  failed setup halts the manager.
- **Do not also set OpenCode's project start command** (`commands.start`, set with
  the API, not the config file) to do the same job. OpenCode runs it on its own,
  without checking its result and while the setup worker runs, so the two would
  race. Checked: it does run on creation in V2. It lives in OpenCode's per-user
  database, so it cannot be shared through the repo and cannot recover from errors,
  which is why this uses a guidance file and an agent instead.
- **Cleanup is yours.** `git worktree list` shows them. Remove one with
  `git worktree remove <dir>` and delete its branch when you have merged or dropped
  the work. Anything setup created outside the worktree (a database) is yours to
  drop too.
- **How reliable this is.** The manager follows the steps because its prompt makes
  them its first action. With the one model tried (gpt-6-luna) that worked in 3 of
  3 runs after the wording was moved to the top of the prompt, and in 1 of about 4
  before. It is an instruction, not an enforcement. A plugin that creates the
  worktree itself when a manager session starts would be, and is not built.
