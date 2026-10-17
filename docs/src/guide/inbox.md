---
title: Inbox
abstract: The inbox lists the merge requests, issues and To-Dos that need you across every member project, sorted by who has to act next.
---

![The inbox in demo mode](/assets/screenshots/inbox.png)

## Sections

| Section | Contains |
|---|---|
| Needs your action | Your MRs with conflicts, a failed pipeline, ready to merge, needing a rebase or with unresolved threads; MRs where your review is requested; To-Dos where you are mentioned or approval is required |
| Waiting on others | Your MRs waiting for review or approval, drafts, MRs with a running pipeline |
| Assigned | Issues assigned to you and other To-Dos |

Each row shows the reason, the project, the pipeline status for MRs, and a watch button.

## Where the data comes from

The inbox uses GitLab's user-scoped endpoints, so it covers every project you are a member of, not only recently active ones:

- `GET /merge_requests?scope=created_by_me&state=opened`
- `GET /merge_requests?reviewer_username=<you>&state=opened`
- `GET /issues?scope=assigned_to_me&state=opened`
- `GET /todos?state=pending`
- one `GET /projects/:id/merge_requests/:iid` per authored MR (up to 20) for the head pipeline and detailed merge status

A To-Do about an item already in the list is folded into that row and can raise it to **Needs your action**. Your own MRs never appear as review requests.

## Reasons

| Reason | Section | Trigger |
|---|---|---|
| Merge conflicts | action | `has_conflicts` |
| Pipeline failed | action | head pipeline failed, or a `build_failed` To-Do |
| Ready to merge | action | `detailed_merge_status = mergeable` |
| Needs rebase | action | `need_rebase` |
| Unresolved threads | action | `discussions_not_resolved` |
| Review requested | action | you are a reviewer (drafts go to waiting) |
| Approval required, Mentioned | action | To-Do |
| Pipeline running | waiting | head pipeline running or pending |
| Waiting for approval, Waiting for review, Draft | waiting | your MR, nothing for you to do |
| Assigned, Marked as To-Do | assigned | issue assignment or To-Do |

## Refresh

The inbox refreshes with the auto-fetch timer (30 seconds by default) and is cached for 30 seconds. **Refresh** forces a fetch. If one GitLab source fails, the others still show, with an error banner naming the failed source.

## For agents

`get_inbox` (MCP) and `GET /api/agent/inbox` (REST) return the same items with `bucket`, `reason`, `reference` and `web_url`. See [MCP server](/agents/mcp/).
