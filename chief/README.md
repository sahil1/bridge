# Chief of staff

The chief of staff is an agent you talk to instead of switching between agent windows. You tell it what you want. For project work it finds the agent that already has the context (or starts a new one in the right folder and space), writes it a complete brief, keeps track of the hand-off, and tells you when something is done or needs you. Standalone tasks that belong to no project (questions, research, drafts, plans, checklists) it does itself, in its own `work/` folder, and ticks off on its task list.

It never edits your projects' files, never answers an agent's permission prompt for you, and won't send, post, merge, deploy or change tickets (or ask an agent to) unless you asked for that.

## What's in this folder

| File | What it is |
| --- | --- |
| `INSTRUCTIONS.md` | The template for the chief's instructions. Bridge AI writes it out as `CLAUDE.md`, `AGENTS.md` and `GEMINI.md` so any supported agent can run as chief. `{{name}}` becomes your name; `{{playbook}}` pulls in the playbook. |
| `state/playbook.md` | Starter playbook: what the chief has learned about how you work. |
| `state/ledger.md` | Starter ledger: hand-offs that are open or recently closed. |
| `state/tasks.md` | Starter task list: work the chief does itself. It's changed through `bin/bridge task`, which the Tasks panel in Bridge AI shares. |
| `bin/bridge` | The command line the chief uses to see and drive agents. Run `node bin/bridge help`. |
| `.claude/settings.json` | Lets Claude Code run `bin/bridge` and edit `state/` and `work/` without asking. |

The chief's working folder lives in your Bridge AI data folder, under `chief/`. The instructions and `bin/bridge` are refreshed from this template each time Bridge AI starts; a chief that's already running reads them when it next starts. Your playbook, ledger and task list are copied once (a folder from an older version gets the ones it lacks) and never overwritten, so they stay yours and never land in the repo. What the chief makes for its tasks goes in `work/` there.

## How it learns

The chief edits `state/playbook.md` as it works and mentions each change in a few words at the end of its reply. It records:

- **Where work lives**: which space, tab and folder each topic goes to.
- **Corrections**: when you say "not that one", the rule it should have followed.
- **Preferences**: how much detail you want, when to ask first, naming.
- **Briefs that work**: context a kind of task always needs.
- **Outcomes**: hand-offs that went badly and what to change.

Corrections teach it the most. If a hand-off goes to the wrong place, say so plainly and it will write down the rule.

## Editing the playbook

Open `chief/state/playbook.md` in your Bridge AI data folder in any editor, or ask the chief to change it ("forget the rule about the docs tab"). Write short rules, one per line. Lines in the playbook override the default instructions. Keep it under about 150 lines; the chief prunes it when it grows past that. Don't put secrets or credentials in it.

To start over, delete `state/playbook.md`, `state/ledger.md` or `state/tasks.md` there; a fresh copy is made the next time Bridge AI starts.

## Sources

The instructions draw on these references:

- Anthropic, "How we built our multi-agent research system": https://www.anthropic.com/engineering/multi-agent-research-system (self-contained subagent briefs with objective, output format and boundaries; scaling effort to the request; parallel delegation)
- Anthropic, "Building effective agents": https://www.anthropic.com/engineering/building-effective-agents (routing and orchestrator-workers patterns, simplicity, human checkpoints and stop conditions)
- Anthropic, "Effective context engineering for AI agents": https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents (prompt at the right altitude, canonical examples over edge-case lists, persistent notes outside the context window)
- Claude Code docs, "Best practices for Claude Code": https://code.claude.com/docs/en/best-practices (short instruction files, verification criteria in every task, evidence over claims, restart after repeated corrections)
- Claude Code docs, "Subagents": https://code.claude.com/docs/en/sub-agents (delegation by description, condensed summaries back to the lead)
- OpenAI, "A practical guide to building agents": https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf (clear actions and edge cases in instructions, manager pattern, failure thresholds and high-risk actions as triggers for handing back to a human)
- OpenAI Agents SDK, "Orchestrating multiple agents": https://openai.github.io/openai-agents-python/multi_agent/ (agents as tools vs handoffs, parallel vs chained work, iterating on prompts from failures)
- Seth Sivak, "Delegate with autonomy using commander's intent": https://sethsivak.substack.com/p/delegate-with-autonomy-using-commanders (purpose, end state and constraints as the core of a delegation brief)
