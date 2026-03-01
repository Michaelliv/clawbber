# Trunk-Based Development with Feature Flags

Date: 2026-02-19
Participants: [[michael]], [[shahaf]]

## The Problem
In gitflow, feature branches can stay out of main forever ("אלף שנים"). Code isolation creates drift.

## The Approach
Work on main as much as possible, use feature flags to toggle features on/off via env or config.

**Branching allowed but time-limited:**
"בtrunk based development מותר לך לצאת לבראנצ׳ אבל אתה יוצא אליו לחצי יום, יום" - half day, one day max, then merge back.

**Core principle:**
"ככה קוד לא נשאר בחוץ" - this way code doesn't stay outside main.

## Challenge: Parallel Work
[[shahaf]] questioned how to work on multiple features simultaneously: "מה אתה עושה שאתה עובד על כמה פיצרים במקביל"

**Answer:** Feature flags enable deploying incomplete features to main (disabled), while continuing development.

## Multi-Agent Context
For running multiple agents on same codebase:
- Still can branch to separate directories
- Need lock files on top of git for coordination
- See [[agent-teams-blog-post]] for [[michael]]'s methodology
- Not fully solved: "לא בעיה שהיא לגמרי פתורה"
