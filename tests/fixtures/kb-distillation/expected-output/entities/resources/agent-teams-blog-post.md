# Agent Teams Blog Post

Type: blog post
URL: https://michaellivs.com/blog/agent-teams-built-a-c-compiler/
Shared by: [[michael]] on 2026-02-19

## What it covers
Multi-agent coordination building a C compiler. Addresses methodology for multiple agents working on same codebase.

## Why shared
Response to [[shahaf]]'s challenge about running multiple agents in parallel on same codebase. [[shahaf]] claimed it's impossible ("בלתי אפשרי הם מתנגדים").

## Key approach mentioned
"צריך lock files מעל גיט שagent יחכה שישחחרו אותו במקרה וagent אחר עובד מעליו" - Need lock files on top of git so agents wait their turn when another is working.

## Status
[[michael]] acknowledges it's "לא בעיה שהיא לגמרי פתורה" - not a completely solved problem, requires different methodology.
